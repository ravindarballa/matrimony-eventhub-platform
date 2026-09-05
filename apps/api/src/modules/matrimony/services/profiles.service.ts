import {
  BadRequestException,
  ConflictException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { Types } from 'mongoose';
import type { Model } from 'mongoose';
import {
  ErrorCode,
  MIN_AGE_BY_GENDER,
  PhotoPrivacy,
  ProfileStatus,
  formatInr,
  type Gender,
  type GunaResult,
  type MatrimonyProfileDto,
  type PartnerPreferencesDto,
  type Paisa,
  type ProfileCardDto,
  type ProfileDetailDto,
  type UpsertProfileRequest,
} from '@eventhub/contracts';

import { User, type UserDocument } from '../../auth/schemas/user.schema.js';
import {
  MatrimonyProfile,
  type MatrimonyProfileDocument,
} from '../schemas/matrimony-profile.schema.js';
import {
  PartnerPreference,
  type PartnerPreferenceDocument,
} from '../schemas/matrimony-social.schema.js';
import { GunaService } from './guna.service.js';
import { RelationsService } from './relations.service.js';

/** A profile must be this complete before it can go live. */
const MIN_COMPLETENESS_TO_PUBLISH = 60;

/**
 * How much each section is worth out of 100. Photos and horoscope carry real
 * weight because a profile without them gets very little interest, and the
 * completeness number exists to say so before the member finds out the slow way.
 */
const COMPLETENESS_WEIGHTS = {
  basics: 25,
  about: 10,
  education: 15,
  career: 15,
  family: 10,
  horoscope: 15,
  photos: 10,
} as const;

@Injectable()
export class ProfilesService {
  private readonly logger = new Logger(ProfilesService.name);

  constructor(
    @InjectModel(MatrimonyProfile.name)
    private readonly profiles: Model<MatrimonyProfileDocument>,
    @InjectModel(PartnerPreference.name)
    private readonly preferences: Model<PartnerPreferenceDocument>,
    @InjectModel(User.name) private readonly users: Model<UserDocument>,
    private readonly relations: RelationsService,
    private readonly guna: GunaService,
    private readonly events: EventEmitter2,
  ) {}

  // ------------------------------------------------------------------ writing

  /**
   * Creates or updates the caller's own profile.
   *
   * The age check is not a validation nicety: below 18 for a bride or 21 for a
   * groom, a marriage is not legal in India, and a platform that lists such a
   * profile is participating in arranging one. It is enforced here, server-side,
   * regardless of what any client allows.
   */
  async upsert(
    userId: string,
    dto: UpsertProfileRequest,
  ): Promise<MatrimonyProfileDto> {
    const dob = new Date(dto.dateOfBirth);
    if (Number.isNaN(dob.getTime())) {
      throw new BadRequestException({
        code: ErrorCode.VALIDATION_FAILED,
        fields: { dateOfBirth: 'Enter a valid date of birth.' },
      });
    }

    const age = ageFrom(dob);
    const minimum = MIN_AGE_BY_GENDER[dto.gender as Gender];
    if (age < minimum) {
      throw new BadRequestException({
        code: ErrorCode.MAT_UNDERAGE,
        message: `The legal minimum age to marry in India is ${minimum}.`,
        fields: { dateOfBirth: `Must be at least ${minimum} years old.` },
      });
    }

    const existing = await this.profiles.findOne({
      userId: new Types.ObjectId(userId),
    });

    const profile =
      existing ??
      new this.profiles({
        userId: new Types.ObjectId(userId),
        status: ProfileStatus.DRAFT,
      });

    Object.assign(profile, {
      displayName: dto.displayName,
      managedBy: dto.managedBy,
      gender: dto.gender,
      dateOfBirth: dob,
      heightCm: dto.heightCm,
      maritalStatus: dto.maritalStatus,
      religion: dto.religion,
      community: dto.community,
      gotra: dto.gotra,
      motherTongue: dto.motherTongue,
      city: dto.city,
      state: dto.state,
      diet: dto.diet,
      about: dto.about,
    });

    // Partial sections merge rather than replace, so the wizard can autosave one
    // step at a time without wiping the steps the member has not reached yet.
    if (dto.education) Object.assign(profile.education, dto.education);
    if (dto.career) Object.assign(profile.career, dto.career);
    if (dto.family) Object.assign(profile.family, dto.family);
    if (dto.horoscope) Object.assign(profile.horoscope, dto.horoscope);
    if (dto.privacy) Object.assign(profile.privacy, dto.privacy);

    profile.completeness = this.completeness(profile);
    await profile.save();

    return this.toOwnDto(profile);
  }

  /** Publishes a draft. A thin profile is refused rather than quietly listed. */
  async publish(userId: string): Promise<MatrimonyProfileDto> {
    const profile = await this.requireOwn(userId);

    if (profile.completeness < MIN_COMPLETENESS_TO_PUBLISH) {
      throw new ConflictException({
        code: ErrorCode.VALIDATION_FAILED,
        message: `Your profile is ${profile.completeness}% complete. It needs ${MIN_COMPLETENESS_TO_PUBLISH}% before it can go live.`,
      });
    }

    profile.status = ProfileStatus.ACTIVE;
    await profile.save();
    return this.toOwnDto(profile);
  }

  /** Takes a profile out of search without deleting anything. */
  async hide(userId: string): Promise<MatrimonyProfileDto> {
    const profile = await this.requireOwn(userId);
    profile.status = ProfileStatus.HIDDEN;
    await profile.save();
    return this.toOwnDto(profile);
  }

  /**
   * The conversion moment.
   *
   * Marking a profile engaged takes it out of matrimony search and hands off to
   * the events side - a family that has just fixed a match is exactly the
   * family that needs a venue. The event carries the city so the handoff can
   * suggest vendors who actually work there.
   */
  async markEngaged(userId: string): Promise<MatrimonyProfileDto> {
    const profile = await this.requireOwn(userId);

    if (profile.status === ProfileStatus.ENGAGED) return this.toOwnDto(profile);

    profile.status = ProfileStatus.ENGAGED;
    profile.engagedAt = new Date();
    await profile.save();

    // Getting engaged is precisely the moment a seeker becomes a wedding
    // customer, so the role is granted here rather than left for them to
    // discover they lack. Without it the handoff below leads to a locked door:
    // the customer portal is role-guarded, and a seeker would be bounced.
    await this.users.updateOne(
      { _id: profile.userId },
      { $addToSet: { roles: 'CUSTOMER' } },
    );

    this.events.emit('matrimony.engaged', {
      profileId: profile.id as string,
      userId,
      city: profile.city,
      displayName: profile.displayName,
    });
    this.logger.log(`Profile ${profile.id as string} marked engaged`);

    return this.toOwnDto(profile);
  }

  async savePreferences(
    userId: string,
    dto: Omit<PartnerPreferencesDto, 'profileId'>,
  ): Promise<PartnerPreferencesDto> {
    const profile = await this.requireOwn(userId);

    if (dto.ageMin > dto.ageMax) {
      throw new BadRequestException({
        code: ErrorCode.VALIDATION_FAILED,
        fields: { ageMin: 'The minimum age cannot be above the maximum.' },
      });
    }

    const saved = await this.preferences.findOneAndUpdate(
      { profileId: profile._id },
      { $set: { ...dto, profileId: profile._id } },
      { upsert: true, new: true },
    );

    return this.toPreferencesDto(saved!);
  }

  async getPreferences(userId: string): Promise<PartnerPreferencesDto | null> {
    const profile = await this.requireOwn(userId);
    const found = await this.preferences.findOne({ profileId: profile._id });
    return found ? this.toPreferencesDto(found) : null;
  }

  // ------------------------------------------------------------------ reading

  async findOwn(userId: string): Promise<MatrimonyProfileDto | null> {
    if (!Types.ObjectId.isValid(userId)) return null;
    const profile = await this.profiles.findOne({
      userId: new Types.ObjectId(userId),
    });
    return profile ? this.toOwnDto(profile) : null;
  }

  async requireOwn(userId: string): Promise<MatrimonyProfileDocument> {
    if (!Types.ObjectId.isValid(userId)) throw new NotFoundException();
    const profile = await this.profiles.findOne({
      userId: new Types.ObjectId(userId),
    });
    if (!profile) {
      throw new NotFoundException({
        code: ErrorCode.VALIDATION_FAILED,
        message: 'Create your profile first.',
      });
    }
    return profile;
  }

  async findById(profileId: string): Promise<MatrimonyProfileDocument> {
    if (!Types.ObjectId.isValid(profileId)) throw new NotFoundException();
    const profile = await this.profiles.findById(profileId);
    if (!profile) throw new NotFoundException();
    return profile;
  }

  /**
   * One profile, as a particular viewer is allowed to see it.
   *
   * A blocked profile returns 404 rather than 403: confirming that a profile
   * exists but is hidden from you tells the blocked party they were blocked,
   * which is precisely what a block is meant to avoid.
   */
  async viewProfile(
    profileId: string,
    viewerUserId: string,
  ): Promise<ProfileDetailDto> {
    const viewer = await this.requireOwn(viewerUserId);
    const target = await this.findById(profileId);

    if (await this.relations.isBlocked(viewer._id, target._id)) {
      throw new NotFoundException();
    }

    // A draft or hidden profile is nobody else's business.
    if (
      !viewer._id.equals(target._id) &&
      target.status !== ProfileStatus.ACTIVE &&
      target.status !== ProfileStatus.ENGAGED
    ) {
      throw new NotFoundException();
    }

    const mutual = await this.relations.hasMutualAcceptance(viewer._id, target._id);
    const [interests, shortlisted] = await Promise.all([
      this.relations.interestsFrom(viewer._id, [target._id]),
      this.relations.shortlistedAmong(viewer._id, [target._id]),
    ]);

    const compatibility = this.compatibility(viewer, target);
    const card = this.toCard(target, {
      mutual,
      gunaScore: compatibility?.total ?? null,
      interestStatus: interests.get(target.id as string) ?? null,
      shortlisted: shortlisted.has(target.id as string),
    });

    const contact = mutual ? await this.contactFor(target) : null;

    return {
      ...card,
      managedBy: target.managedBy as ProfileDetailDto['managedBy'],
      maritalStatus: target.maritalStatus as ProfileDetailDto['maritalStatus'],
      motherTongue: target.motherTongue,
      gotra: target.gotra ?? null,
      diet: target.diet as ProfileDetailDto['diet'],
      about: target.about ?? null,
      educationDetails: {
        highestQualification: target.education.highestQualification ?? '',
        fieldOfStudy: target.education.fieldOfStudy ?? null,
        institution: target.education.institution ?? null,
      },
      career: {
        occupation: target.career.occupation ?? '',
        employer: target.career.employer ?? null,
        // A band, never the figure: an exact salary is not something to publish.
        incomeBand: incomeBand(target.career.annualIncome),
      },
      family: {
        fatherOccupation: target.family.fatherOccupation ?? null,
        motherOccupation: target.family.motherOccupation ?? null,
        siblings: target.family.siblings ?? null,
        familyType:
          (target.family.familyType as 'JOINT' | 'NUCLEAR' | undefined) ?? null,
        nativePlace: target.family.nativePlace ?? null,
      },
      // Birth time and place never leave the server.
      horoscope: {
        nakshatra: target.horoscope.nakshatra ?? null,
        rashi: target.horoscope.rashi ?? null,
        marsHouse: target.horoscope.marsHouse ?? null,
        manglik: target.horoscope.manglik ?? null,
      },
      photos: this.visiblePhotos(target, mutual),
      contact,
      compatibility,
    };
  }

  /** The guna score between two profiles, when both have entered a horoscope. */
  compatibility(
    a: MatrimonyProfileDocument,
    b: MatrimonyProfileDocument,
  ): GunaResult | null {
    // Ashtakoota is directional: the bride's chart is read against the groom's.
    const bride = a.gender === 'FEMALE' ? a : b;
    const groom = a.gender === 'FEMALE' ? b : a;
    if (bride === groom) return null;

    return this.guna.score(bride.horoscope, groom.horoscope);
  }

  /**
   * The card shape used by search, interests and shortlists.
   *
   * Whether a photo is on the wire at all is decided here. A blurred or
   * withheld photo is absent rather than flagged, because a URL that reaches
   * the browser has already leaked regardless of what the client does with it.
   */
  toCard(
    profile: MatrimonyProfileDocument,
    context: {
      mutual: boolean;
      gunaScore?: number | null;
      interestStatus?: ProfileCardDto['interestStatus'];
      shortlisted?: boolean;
    },
  ): ProfileCardDto {
    const primary = profile.photos.find(
      (p) => p.isPrimary && p.moderation === 'APPROVED',
    );
    const visible = this.photoVisible(profile, context.mutual);

    return {
      id: profile.id as string,
      displayName: profile.displayName,
      age: ageFrom(profile.dateOfBirth),
      heightCm: profile.heightCm,
      religion: profile.religion,
      community: profile.community,
      city: profile.city,
      education: profile.education.highestQualification ?? '',
      occupation: profile.career.occupation ?? '',
      photoUrl: visible ? (primary?.url ?? null) : null,
      photosBlurred: !visible && Boolean(primary),
      gunaScore: context.gunaScore ?? null,
      interestStatus: context.interestStatus ?? null,
      shortlisted: context.shortlisted ?? false,
    };
  }

  /** The four privacy modes, applied in one place. */
  private photoVisible(
    profile: MatrimonyProfileDocument,
    mutual: boolean,
  ): boolean {
    switch (profile.privacy.photos) {
      case PhotoPrivacy.PUBLIC:
      case PhotoPrivacy.MEMBERS_ONLY:
        return true;
      case PhotoPrivacy.BLURRED_UNTIL_MUTUAL:
      case PhotoPrivacy.ON_REQUEST:
        return mutual;
      default:
        return false;
    }
  }

  private visiblePhotos(
    profile: MatrimonyProfileDocument,
    mutual: boolean,
  ): { id: string; url: string | null; isPrimary: boolean }[] {
    const visible = this.photoVisible(profile, mutual);
    return profile.photos
      .filter((p) => p.moderation === 'APPROVED')
      .map((p) => ({
        id: p.id,
        url: visible ? p.url : null,
        isPrimary: p.isPrimary,
      }));
  }

  private async contactFor(
    profile: MatrimonyProfileDocument,
  ): Promise<ProfileDetailDto['contact']> {
    const user = await this.users.findById(profile.userId);
    if (!user) return null;
    return {
      mobile: user.mobile,
      managedBy: profile.managedBy as ProfileDetailDto['managedBy'],
    };
  }

  /**
   * How complete a profile is, as a percentage.
   *
   * The weights are opinionated on purpose: a profile with no photo and no
   * horoscope gets very little interest, so it should not read as nearly done.
   */
  completeness(profile: MatrimonyProfileDocument): number {
    let score = 0;

    if (
      profile.displayName &&
      profile.dateOfBirth &&
      profile.heightCm &&
      profile.religion &&
      profile.community &&
      profile.city &&
      profile.motherTongue
    ) {
      score += COMPLETENESS_WEIGHTS.basics;
    }
    if ((profile.about?.length ?? 0) >= 50) score += COMPLETENESS_WEIGHTS.about;
    if (profile.education.highestQualification) {
      score += COMPLETENESS_WEIGHTS.education;
    }
    if (profile.career.occupation) score += COMPLETENESS_WEIGHTS.career;
    if (profile.family.fatherOccupation || profile.family.nativePlace) {
      score += COMPLETENESS_WEIGHTS.family;
    }
    if (profile.horoscope.nakshatra && profile.horoscope.rashi) {
      score += COMPLETENESS_WEIGHTS.horoscope;
    }
    if (profile.photos.some((p) => p.moderation === 'APPROVED')) {
      score += COMPLETENESS_WEIGHTS.photos;
    }

    return score;
  }

  toOwnDto(profile: MatrimonyProfileDocument): MatrimonyProfileDto {
    return {
      id: profile.id as string,
      userId: profile.userId.toString(),
      displayName: profile.displayName,
      managedBy: profile.managedBy as MatrimonyProfileDto['managedBy'],
      gender: profile.gender as Gender,
      dateOfBirth: profile.dateOfBirth.toISOString(),
      age: ageFrom(profile.dateOfBirth),
      heightCm: profile.heightCm,
      maritalStatus: profile.maritalStatus as MatrimonyProfileDto['maritalStatus'],
      religion: profile.religion,
      community: profile.community,
      gotra: profile.gotra ?? null,
      motherTongue: profile.motherTongue,
      city: profile.city,
      state: profile.state ?? null,
      diet: profile.diet as MatrimonyProfileDto['diet'],
      about: profile.about ?? null,
      education: {
        highestQualification: profile.education.highestQualification ?? '',
        fieldOfStudy: profile.education.fieldOfStudy ?? null,
        institution: profile.education.institution ?? null,
      },
      career: {
        occupation: profile.career.occupation ?? '',
        employer: profile.career.employer ?? null,
        annualIncome: (profile.career.annualIncome as Paisa | undefined) ?? null,
      },
      family: {
        fatherOccupation: profile.family.fatherOccupation ?? null,
        motherOccupation: profile.family.motherOccupation ?? null,
        siblings: profile.family.siblings ?? null,
        familyType:
          (profile.family.familyType as 'JOINT' | 'NUCLEAR' | undefined) ?? null,
        nativePlace: profile.family.nativePlace ?? null,
      },
      horoscope: {
        birthTime: profile.horoscope.birthTime ?? null,
        birthPlace: profile.horoscope.birthPlace ?? null,
        nakshatra: profile.horoscope.nakshatra ?? null,
        rashi: profile.horoscope.rashi ?? null,
        marsHouse: profile.horoscope.marsHouse ?? null,
        manglik: profile.horoscope.manglik ?? null,
      },
      photos: profile.photos.map((p) => ({
        id: p.id,
        url: p.url,
        isPrimary: p.isPrimary,
        moderation: p.moderation,
        rejectionReason: p.rejectionReason ?? null,
      })),
      privacy: {
        photos: profile.privacy.photos,
        showContact: profile.privacy.showContact,
      },
      status: profile.status,
      completeness: profile.completeness,
      verified: profile.verified,
      updatedAt: (profile as unknown as { updatedAt: Date }).updatedAt.toISOString(),
    };
  }

  private toPreferencesDto(
    doc: PartnerPreferenceDocument,
  ): PartnerPreferencesDto {
    return {
      profileId: doc.profileId.toString(),
      ageMin: doc.ageMin,
      ageMax: doc.ageMax,
      heightMinCm: doc.heightMinCm ?? null,
      heightMaxCm: doc.heightMaxCm ?? null,
      communities: doc.communities,
      cities: doc.cities,
      education: doc.education,
      diet: (doc.diet as PartnerPreferencesDto['diet']) ?? null,
      maritalStatuses:
        doc.maritalStatuses as PartnerPreferencesDto['maritalStatuses'],
      excludeGotras: doc.excludeGotras,
    };
  }
}

/** Whole years, counted the way a person counts them. */
export function ageFrom(dob: Date, now = new Date()): number {
  let age = now.getUTCFullYear() - dob.getUTCFullYear();
  const monthDiff = now.getUTCMonth() - dob.getUTCMonth();
  if (monthDiff < 0 || (monthDiff === 0 && now.getUTCDate() < dob.getUTCDate())) {
    age -= 1;
  }
  return age;
}

/** A band rather than a figure. Nobody needs another member's exact salary. */
function incomeBand(annualIncome?: number): string | null {
  if (!annualIncome) return null;
  const lakhs = annualIncome / 100 / 100_000;
  if (lakhs < 5) return `Under ${formatInr(500_000_00 as Paisa)}`;
  if (lakhs < 10) return '₹5–10 lakh';
  if (lakhs < 25) return '₹10–25 lakh';
  if (lakhs < 50) return '₹25–50 lakh';
  return '₹50 lakh+';
}
