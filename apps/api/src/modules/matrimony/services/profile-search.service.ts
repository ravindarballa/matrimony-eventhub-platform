import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Types } from 'mongoose';
import type { Model } from 'mongoose';
import { ProfileStatus, type ProfileCardDto, type ProfileSearchQuery } from '@eventhub/contracts';

import {
  MatrimonyProfile,
  type MatrimonyProfileDocument,
} from '../schemas/matrimony-profile.schema.js';
import { ProfilesService } from './profiles.service.js';
import { RelationsService } from './relations.service.js';

const DEFAULT_LIMIT = 20;
const MAX_LIMIT = 50;

@Injectable()
export class ProfileSearchService {
  constructor(
    @InjectModel(MatrimonyProfile.name)
    private readonly profiles: Model<MatrimonyProfileDocument>,
    private readonly profilesService: ProfilesService,
    private readonly relations: RelationsService,
  ) {}

  /**
   * Matrimony search.
   *
   * Three rules shape the query. Only the opposite gender is ever returned -
   * this is an arranged-marriage product, and showing anything else is a bug
   * families notice immediately. Blocked profiles are removed in both
   * directions, so a block cannot be worked around by searching. And gotra
   * exclusions are a hard filter rather than a ranking signal, because a family
   * that cannot consider a gotra cannot consider it at all.
   */
  async search(
    viewerUserId: string,
    query: ProfileSearchQuery,
  ): Promise<{ items: ProfileCardDto[]; total: number; page: number }> {
    const viewer = await this.profilesService.requireOwn(viewerUserId);

    const page = Math.max(1, query.page ?? 1);
    const limit = Math.min(MAX_LIMIT, Math.max(1, query.limit ?? DEFAULT_LIMIT));

    const blocked = await this.relations.blockedIds(viewer._id);

    const filter: Record<string, unknown> = {
      status: ProfileStatus.ACTIVE,
      gender: viewer.gender === 'MALE' ? 'FEMALE' : 'MALE',
      _id: { $nin: [viewer._id, ...blocked] },
    };

    if (query.religion) filter.religion = ci(query.religion);
    if (query.community) filter.community = ci(query.community);
    if (query.city) filter.city = ci(query.city);
    if (query.motherTongue) filter.motherTongue = ci(query.motherTongue);
    if (query.diet) filter.diet = query.diet;
    if (query.maritalStatus) filter.maritalStatus = query.maritalStatus;

    // Age is a range over dateOfBirth, inverted: the youngest allowed age is
    // the latest allowed birth date.
    const dob: Record<string, Date> = {};
    if (query.ageMax !== undefined) dob.$gte = birthDateFor(query.ageMax + 1);
    if (query.ageMin !== undefined) dob.$lte = birthDateFor(query.ageMin);
    if (Object.keys(dob).length) filter.dateOfBirth = dob;

    const height: Record<string, number> = {};
    if (query.heightMinCm !== undefined) height.$gte = query.heightMinCm;
    if (query.heightMaxCm !== undefined) height.$lte = query.heightMaxCm;
    if (Object.keys(height).length) filter.heightCm = height;

    if (query.excludeGotras?.length) {
      // Case-insensitive, because "Kashyap" and "kashyap" are the same gotra
      // and getting this wrong shows a family a match they cannot consider.
      filter.gotra = { $nin: query.excludeGotras.map((g) => ci(g)) };
    }

    // Sorting by guna needs every candidate scored, so it is done after the
    // fetch; the other two sorts ride the ESR index.
    const sortByGuna = query.sort === 'guna' || query.minGunaScore !== undefined;
    const sort: Record<string, 1 | -1> =
      query.sort === 'age' ? { dateOfBirth: -1 } : { updatedAt: -1 };

    const [rows, total] = await Promise.all([
      this.profiles
        .find(filter)
        .sort(sort)
        // Guna sorting needs a wider net than one page, or the "best matches"
        // would only ever be the best of the twenty most recently updated.
        .skip(sortByGuna ? 0 : (page - 1) * limit)
        .limit(sortByGuna ? MAX_LIMIT * 4 : limit),
      this.profiles.countDocuments(filter),
    ]);

    const ids = rows.map((r) => r._id);
    const [interests, shortlisted] = await Promise.all([
      this.relations.interestsFrom(viewer._id, ids),
      this.relations.shortlistedAmong(viewer._id, ids),
    ]);

    let cards = rows.map((row) => {
      const compatibility = this.profilesService.compatibility(viewer, row);
      return this.profilesService.toCard(row, {
        // Search never unlocks photos on its own; only mutual interest does.
        mutual: false,
        gunaScore: compatibility?.total ?? null,
        interestStatus: interests.get(row.id as string) ?? null,
        shortlisted: shortlisted.has(row.id as string),
      });
    });

    if (query.minGunaScore !== undefined) {
      const floor = query.minGunaScore;
      cards = cards.filter((c) => (c.gunaScore ?? -1) >= floor);
    }

    if (sortByGuna) {
      cards.sort((a, b) => (b.gunaScore ?? -1) - (a.gunaScore ?? -1));
      const start = (page - 1) * limit;
      return {
        items: cards.slice(start, start + limit),
        total: query.minGunaScore !== undefined ? cards.length : total,
        page,
      };
    }

    return { items: cards, total, page };
  }
}

/** An exact match that ignores case, for free-text fields users type. */
function ci(value: string): RegExp {
  return new RegExp(`^${value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`, 'i');
}

/** The birth date of someone turning exactly this age today. */
function birthDateFor(age: number): Date {
  const now = new Date();
  return new Date(
    Date.UTC(now.getUTCFullYear() - age, now.getUTCMonth(), now.getUTCDate()),
  );
}
