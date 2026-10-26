import pool from '../config/db.js';

export const getUserProfile = async (userId) => {
    const query = `
        SELECT "userId", "email", "firstName", "lastName", 
               "phone", "address", "avatarUrl", "role", "status", 
               "createdAt", "updatedAt", "lastLoginAt"
        FROM "users"
        WHERE "userId" = $1
        LIMIT 1;
    `;
    const { rows } = await pool.query(query, [userId]);
    return rows[0] || null;
};

export const updateUserProfile = async (userId, data) => {
    const query = `
        UPDATE "users"
        SET 
            "firstName" = COALESCE($1, "firstName"),
            "lastName" = COALESCE($2, "lastName"),
            "phone" = COALESCE($3, "phone"),
            "address" = COALESCE($4, "address"),
            "avatarUrl" = COALESCE($5, "avatarUrl"),
            "updatedAt" = NOW()
        WHERE "userId" = $6
        RETURNING "userId", "email", "firstName", "lastName", "phone", "address", 
                  "avatarUrl", "role", "status", "createdAt", "updatedAt", "lastLoginAt";
    `;
    const values = [
        data.firstName ? data.firstName.trim() : null,
        data.lastName ? data.lastName.trim() : null,
        data.phone !== undefined ? (data.phone ? data.phone.trim() : null) : null,
        data.address !== undefined ? (data.address ? data.address.trim() : null) : null,
        data.avatarUrl !== undefined ? (data.avatarUrl ? data.avatarUrl.trim() : null) : null,
        userId
    ];
    const { rows } = await pool.query(query, values);
    return rows[0] || null;
};

export const updateUserPassword = async (userId, newPasswordHash) => {
    const query = `
        UPDATE "users"
        SET "passwordHash" = $1, "updatedAt" = NOW()
        WHERE "userId" = $2;
    `;
    await pool.query(query, [newPasswordHash, userId]);
};

const USER_STATUSES = ['active', 'suspended', 'banned'];
const USER_ROLES = ['member', 'admin'];

/**
 * [Admin] List users with status/role filter, search and pagination
 */
export const adminListUsers = async ({ status, role, search, page, limit }) => {
    // escape LIKE wildcards ของผู้ใช้ ไม่ให้ตีความเป็น pattern
    const pattern = search ? `%${search.replace(/[\\%_]/g, '\\$&')}%` : null;

    const query = `
        SELECT "userId", "email", "firstName", "lastName", "phone", "avatarUrl",
               "role", "status", "promotedBy", "lastLoginAt", "createdAt",
               COUNT(*) OVER()::int AS "total"
        FROM "users"
        WHERE ($1::text IS NULL OR "status"::text = $1)
          AND ($2::text IS NULL OR "role"::text = $2)
          AND ($3::text IS NULL
               OR "email" ILIKE $3
               OR ("firstName" || ' ' || "lastName") ILIKE $3)
        ORDER BY "createdAt" DESC, "userId" DESC
        LIMIT $4 OFFSET $5;
    `;
    const { rows } = await pool.query(query, [status, role, pattern, limit, (page - 1) * limit]);
    const total = rows[0]?.total ?? 0;

    return {
        data: rows.map(({ total: _total, ...row }) => row),
        pagination: { page, limit, total, totalPages: Math.ceil(total / limit) }
    };
};

/**
 * [Admin] Change user status (active/suspended/banned) + write userStatusLogs
 */
export const adminChangeUserStatus = async (targetId, adminId, newStatus, reason) => {
    if (!USER_STATUSES.includes(newStatus)) {
        throw { status: 400, message: `Status must be one of: ${USER_STATUSES.join(', ')}` };
    }

    if (!reason?.trim()) {
        throw { status: 400, message: 'Reason is required' };
    }

    if (targetId === adminId) {
        throw { status: 400, message: 'You cannot change your own status' };
    }

    const client = await pool.connect();
    try {
        await client.query('BEGIN');

        const { rows } = await client.query(
            'SELECT "userId", "role", "status" FROM "users" WHERE "userId" = $1 FOR UPDATE;',
            [targetId]
        );
        const target = rows[0];

        if (!target) {
            throw { status: 404, message: 'User not found' };
        }

        if (target.role === 'admin') {
            throw { status: 403, message: 'Demote this admin to member before changing status' };
        }

        if (target.status === newStatus) {
            throw { status: 400, message: `User is already ${newStatus}` };
        }

        const updated = await client.query(
            `
            UPDATE "users"
            SET "status" = $1, "updatedAt" = NOW()
            WHERE "userId" = $2
            RETURNING "userId", "email", "firstName", "lastName", "role", "status", "updatedAt";
            `,
            [newStatus, targetId]
        );

        await client.query(
            `
            INSERT INTO "userStatusLogs" ("userId", "oldStatus", "newStatus", "reason", "changedBy", "changedAt")
            VALUES ($1, $2, $3, $4, $5, NOW());
            `,
            [targetId, target.status, newStatus, reason.trim(), adminId]
        );

        await client.query('COMMIT');
        return updated.rows[0];
    } catch (err) {
        await client.query('ROLLBACK');
        throw err;
    } finally {
        client.release();
    }
};

/**
 * [Admin] Promote active member to admin (records promotedBy) or demote admin to member
 */
export const adminChangeUserRole = async (targetId, adminId, newRole) => {
    if (!USER_ROLES.includes(newRole)) {
        throw { status: 400, message: `Role must be one of: ${USER_ROLES.join(', ')}` };
    }

    if (newRole === 'member' && targetId === adminId) {
        throw { status: 400, message: 'You cannot demote yourself' };
    }

    const client = await pool.connect();
    try {
        await client.query('BEGIN');

        const { rows } = await client.query(
            'SELECT "userId", "role", "status" FROM "users" WHERE "userId" = $1 FOR UPDATE;',
            [targetId]
        );
        const target = rows[0];

        if (!target) {
            throw { status: 404, message: 'User not found' };
        }

        if (target.role === newRole) {
            throw { status: 400, message: `User is already ${newRole}` };
        }

        if (newRole === 'admin' && target.status !== 'active') {
            throw { status: 400, message: 'Only active users can be promoted to admin' };
        }

        // demote: เคลียร์ promotedBy ด้วย เพราะไม่ใช่ admin แล้ว
        const updated = await client.query(
            `
            UPDATE "users"
            SET "role" = $1,
                "promotedBy" = $2::int,
                "updatedAt" = NOW()
            WHERE "userId" = $3
            RETURNING "userId", "email", "firstName", "lastName", "role", "status", "promotedBy", "updatedAt";
            `,
            [newRole, newRole === 'admin' ? adminId : null, targetId]
        );

        await client.query('COMMIT');
        return updated.rows[0];
    } catch (err) {
        await client.query('ROLLBACK');
        throw err;
    } finally {
        client.release();
    }
};

/**
 * [Admin] Set role by email (member or admin) — cannot target yourself
 */
export const adminSetRoleByEmail = async (email, adminId, newRole) => {
    if (!USER_ROLES.includes(newRole)) {
        throw { status: 400, message: `Role must be one of: ${USER_ROLES.join(', ')}` };
    }

    const client = await pool.connect();
    try {
        await client.query('BEGIN');

        const { rows } = await client.query(
            'SELECT "userId", "email", "role", "status" FROM "users" WHERE LOWER("email") = $1 FOR UPDATE;',
            [email]
        );
        const target = rows[0];

        if (!target) {
            throw { status: 404, message: `User with email "${email}" not found` };
        }

        if (target.userId === adminId) {
            throw { status: 400, message: 'You cannot change your own role' };
        }

        if (target.role === newRole) {
            throw { status: 400, message: `User is already "${newRole}"` };
        }

        if (newRole === 'admin' && target.status !== 'active') {
            throw { status: 400, message: 'Only active users can be promoted to admin' };
        }

        const updated = await client.query(
            `
            UPDATE "users"
            SET "role" = $1,
                "promotedBy" = $2::int,
                "updatedAt" = NOW()
            WHERE "userId" = $3
            RETURNING "userId", "email", "firstName", "lastName", "role", "status", "promotedBy", "updatedAt";
            `,
            [newRole, newRole === 'admin' ? adminId : null, target.userId]
        );

        await client.query('COMMIT');
        return updated.rows[0];
    } catch (err) {
        await client.query('ROLLBACK');
        throw err;
    } finally {
        client.release();
    }
};
