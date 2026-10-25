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
