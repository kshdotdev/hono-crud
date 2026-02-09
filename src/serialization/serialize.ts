import type { SerializationProfile, SerializationConfig } from './types';

/**
 * Apply a serialization profile to a single record.
 */
export function applyProfile(
  record: Record<string, unknown>,
  profile: SerializationProfile
): Record<string, unknown> {
  let result: Record<string, unknown>;

  if (profile.include && profile.include.length > 0) {
    // Start with only included fields
    result = {};
    for (const field of profile.include) {
      if (field in record) {
        result[field] = record[field];
      }
    }
  } else {
    // Start with all fields
    result = { ...record };
  }

  // Remove excluded fields
  if (profile.exclude) {
    for (const field of profile.exclude) {
      delete result[field];
    }
  }

  // Ensure always-included fields are present
  if (profile.alwaysInclude) {
    for (const field of profile.alwaysInclude) {
      if (field in record) {
        result[field] = record[field];
      }
    }
  }

  // Apply custom transform
  if (profile.transform) {
    result = profile.transform(result);
  }

  return result;
}

/**
 * Apply a serialization profile to an array of records.
 */
export function applyProfileToArray(
  records: Record<string, unknown>[],
  profile: SerializationProfile
): Record<string, unknown>[] {
  return records.map((r) => applyProfile(r, profile));
}

/**
 * Resolve the active profile from a config and query parameter value.
 */
export function resolveProfile(
  config: SerializationConfig,
  profileName?: string | null
): SerializationProfile | undefined {
  const name = profileName ?? config.defaultProfile;
  if (!name) return undefined;
  return config.profiles.find((p) => p.name === name);
}

/**
 * Create a serializer function from a config.
 * Returns a function that takes a record and query param value,
 * and returns the serialized record.
 */
export function createSerializer(config: SerializationConfig) {
  return (record: Record<string, unknown>, profileName?: string | null): Record<string, unknown> => {
    const profile = resolveProfile(config, profileName);
    if (!profile) return record;
    return applyProfile(record, profile);
  };
}

/**
 * Create an array serializer from a config.
 */
export function createArraySerializer(config: SerializationConfig) {
  return (records: Record<string, unknown>[], profileName?: string | null): Record<string, unknown>[] => {
    const profile = resolveProfile(config, profileName);
    if (!profile) return records;
    return applyProfileToArray(records, profile);
  };
}
