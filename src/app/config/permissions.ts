/**
 * ════════════════════════════════════════════════════════════════════════════
 *  THE SINGLE SOURCE OF TRUTH FOR AUTHORIZATION
 * ════════════════════════════════════════════════════════════════════════════
 *
 * Role strings alone could not answer the two questions the business actually
 * asks ("which manager is this?" and "what may an admin switch off for them?"),
 * so authorization is now expressed as a small, coarse list of CAPABILITIES.
 *
 * Three layers read this vocabulary and they must never disagree:
 *   1. server  → middlewares/auth.ts `requireCapability()` on each route
 *   2. client  → app/providers/protectedRoutes.js (dashboard entry guard)
 *   3. client  → components/admin/AdminSidebar.jsx (menu visibility)
 *
 * Layers 2 and 3 do NOT re-implement the rules: the server resolves a user's
 * capabilities and hands them back on GET /api/auth/me and on login, and the
 * browser only ever reads that list. `sabbirbooks/src/lib/permissions.js`
 * mirrors the vocabulary purely so the admin UI has labels, and so a session
 * created before this feature shipped still has sensible defaults offline.
 *
 * ── How a capability is decided ────────────────────────────────────────────
 *   superAdmin / admin         → every capability, always. Their stored
 *                                `permissions` array is ignored so the two
 *                                live owner accounts can never be locked out.
 *   everyone else              → their stored `permissions` array if an admin
 *                                has ever saved one, otherwise the role's
 *                                default list below.
 *
 * ── Relationship to authorize() ────────────────────────────────────────────
 * A capability NEVER widens access. Routes keep their existing
 * `authorize(...roles)` gate and `requireCapability(...)` is composed AFTER it,
 * so both must pass. That is why e.g. `mentor` carries `content.write` here —
 * it describes the lesson material a mentor already uploads today; it does not
 * hand them the book or blog routes, because `authorize()` still excludes them.
 */

export const ROLES = [
  'superAdmin',
  'admin',
  'trainingManager',
  'contentManager',
  'manager',
  'mentor',
  'student',
  // A coupon owner — someone who sells books through their own discount code.
  // They hold NO admin capability at all; their only screen is their own
  // affiliate dashboard, which shows the sales and earnings of their codes.
  'affiliate',
] as const;

export type Role = (typeof ROLES)[number];

/**
 * The three kinds of manager.
 *
 * `trainingManager` already existed and is the *operations* manager: it runs
 * batches, enrollments, certificates, class schedules and student accounts, and
 * reads the operational dashboards — but never site settings and never staff.
 *
 * `contentManager` is new and is the *content-only* group asked for: it uploads
 * and deletes every kind of content and can see nothing else — not who bought
 * what, not how much sold, not the site settings.
 *
 * `manager` is the add-and-edit role: it creates and updates content and runs
 * training operations, but cannot DELETE anything and cannot see orders,
 * sales figures or personal details. It is the same shape as contentManager
 * plus training, minus the delete capability.
 *
 * Only these three roles have editable permissions.
 */
export const MANAGER_ROLES: Role[] = ['trainingManager', 'contentManager', 'manager'];

// ── The capability vocabulary ──────────────────────────────────────────────
// Deliberately coarse: one line per thing an admin would actually want to
// switch on or off. `group` and `label` drive the admin permission matrix.
export const CAPABILITIES = [
  {
    key: 'content.write',
    label: 'Content — add & edit',
    group: 'Content',
    description:
      'Create and edit books, book content (QR topics), blogs, courses, lessons, categories, notices, partners, mentor profiles and site pages. Deleting is a separate permission.',
  },
  {
    key: 'records.delete',
    label: 'Delete — content & records',
    group: 'Content',
    description:
      'Permanently remove books, book content (QR topics), blogs, courses, lessons, categories, notices, partners, mentor profiles, batches, certificates and coupons. Without this a manager can still add and edit everything, but never delete.',
  },
  {
    key: 'training.manage',
    label: 'Training operations',
    group: 'Training',
    description:
      'Run batches, enrollments, class schedules, certificates, coupons and installment plans.',
  },
  {
    key: 'orders.read',
    label: 'Orders — view',
    group: 'Business data',
    description: 'See book orders: who bought what, delivery addresses and payment state.',
  },
  {
    key: 'orders.write',
    label: 'Orders — approve & update',
    group: 'Business data',
    description: 'Approve or reject manual payments and change fulfilment status.',
  },
  {
    key: 'analytics.read',
    label: 'Analytics & reports',
    group: 'Business data',
    description: 'Dashboards, sales counts, revenue and income reports.',
  },
  {
    key: 'users.read',
    label: 'Users — view',
    group: 'People',
    description: 'See user accounts and their personal details (name, email, phone, address).',
  },
  {
    key: 'users.write',
    label: 'Users — create, edit & delete',
    group: 'People',
    description: 'Create student accounts, edit user details, reset passwords, delete accounts.',
  },
  {
    key: 'settings.write',
    label: 'Site settings',
    group: 'Site',
    description: 'Change the site name, logo, delivery charges and payment options.',
  },
  {
    key: 'staff.manage',
    label: 'Staff & permissions',
    group: 'Site',
    description:
      'Create staff accounts and decide what each manager may do. Reserved for Admin / Super Admin — it can never be granted to a manager.',
  },
] as const;

export type Capability = (typeof CAPABILITIES)[number]['key'];

export const CAPABILITY_KEYS: Capability[] = CAPABILITIES.map((c) => c.key);

/**
 * What an admin is allowed to toggle on a manager.
 *
 * `staff.manage` is deliberately absent. If it were grantable, a manager could
 * be handed the permission editor and then raise their own permissions — the
 * one escalation this whole design exists to prevent.
 */
export const GRANTABLE_CAPABILITIES: Capability[] = CAPABILITY_KEYS.filter(
  (k) => k !== 'staff.manage',
);

/**
 * Defaults, applied when a user has no stored `permissions` array.
 *
 * MIGRATION NOTE — the live database has 7 users and none of them has a
 * `permissions` field. Every list below is written to reproduce exactly what
 * that role can reach today, so shipping this changes nobody's access until an
 * admin deliberately edits a manager in the permission matrix.
 */
export const ROLE_DEFAULT_CAPABILITIES: Record<Role, Capability[]> = {
  // Full access. Also bypasses every gate in authorize()/requireCapability().
  superAdmin: [...CAPABILITY_KEYS],
  // Full access. Never read from the stored array — see resolveCapabilities().
  admin: [...CAPABILITY_KEYS],
  // Exactly today's reach: content + training ops + student accounts +
  // operational dashboards. No orders, no settings, no staff.
  trainingManager: [
    'content.write',
    'records.delete',
    'training.manage',
    'users.read',
    'users.write',
    'analytics.read',
  ],
  // The content-only group: adds, edits and deletes content, sees nothing else.
  contentManager: ['content.write', 'records.delete'],
  // Describes what a mentor already does (lesson material, class schedules,
  // attendance/grading, their own batch analytics). authorize() still limits
  // them to the mentor routes.
  mentor: ['content.write', 'records.delete', 'training.manage', 'analytics.read'],
  // The add-and-edit manager. Adds and updates content and training
  // operations, and deliberately holds none of:
  //   records.delete → cannot remove anything
  //   orders.*       → cannot see who bought what, or how many orders came in
  //   analytics.read → cannot see sales, revenue or any reporting
  //   users.*        → cannot browse personal details
  //   settings.write → cannot change the site
  manager: ['content.write', 'training.manage'],
  student: [],
  // A coupon owner sees only their own earnings screen, which is gated on being
  // the coupon's owner — never on a capability. Deliberately empty.
  affiliate: [],
};

const isRole = (value: unknown): value is Role =>
  typeof value === 'string' && (ROLES as readonly string[]).includes(value);

/**
 * Resolve the capabilities a user actually has.
 *
 * @param role        the role stored on the user document (NOT the JWT, which
 *                    may predate a role change)
 * @param permissions the stored permissions array, or undefined/null when the
 *                    user has never had one saved
 *
 * An empty array is honoured as "nothing": an admin who unticks every box means
 * it. Only a missing/invalid value falls back to the role default.
 */
export const resolveCapabilities = (role: unknown, permissions?: unknown): Capability[] => {
  if (!isRole(role)) return [];

  // Owner accounts are fixed at full access — a stored array can never shrink
  // them, so a bad write to the permissions field cannot brick the panel.
  if (role === 'superAdmin' || role === 'admin') return [...CAPABILITY_KEYS];

  if (Array.isArray(permissions)) {
    const stored = permissions.filter((p): p is Capability =>
      (CAPABILITY_KEYS as string[]).includes(p as string),
    );
    // staff.manage is never grantable, even if it somehow reached the document.
    return stored.filter((c) => c !== 'staff.manage');
  }

  return [...ROLE_DEFAULT_CAPABILITIES[role]];
};

/** True when the user has every one of `required`. */
export const hasCapability = (
  role: unknown,
  permissions: unknown,
  ...required: Capability[]
): boolean => {
  const owned = resolveCapabilities(role, permissions);
  return required.every((cap) => owned.includes(cap));
};

/**
 * Clean an incoming permissions array from the admin UI: keep only known,
 * grantable capabilities and drop duplicates. Anything else — typos, injected
 * strings, `staff.manage` — is silently discarded rather than trusted.
 */
export const sanitizePermissions = (input: unknown): Capability[] => {
  if (!Array.isArray(input)) return [];
  const seen = new Set<string>();
  const out: Capability[] = [];
  for (const raw of input) {
    if (typeof raw !== 'string') continue;
    if (!(GRANTABLE_CAPABILITIES as string[]).includes(raw)) continue;
    if (seen.has(raw)) continue;
    seen.add(raw);
    out.push(raw as Capability);
  }
  return out;
};

/** Roles whose permissions an admin may edit. */
export const isManagerRole = (role: unknown): boolean =>
  isRole(role) && MANAGER_ROLES.includes(role);
