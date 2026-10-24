import pool from '../config/db.js';

export const findUserByEmail = async (email) => {
    const query = `
        SELECT "userId", "email", "passwordHash", "firstName", "lastName", 
               "phone", "address", "avatarUrl", "role", "status"
        FROM "users"
        WHERE LOWER("email") = LOWER($1)
        LIMIT 1;
    `;
    const { rows } = await pool.query(query, [email.trim()]);
    return rows[0] || null;
};

export const findUserById = async (userId) => {
    const query = `
        SELECT "userId", "email", "firstName", "lastName", 
               "phone", "address", "avatarUrl", "role", "status", 
               "createdAt", "lastLoginAt"
        FROM "users"
        WHERE "userId" = $1
        LIMIT 1;
    `;
    const { rows } = await pool.query(query, [userId]);
    return rows[0] || null;
};

export const createUser = async ({ email, passwordHash, firstName, lastName, phone = null, address = null }) => {
    const query = `
        INSERT INTO "users" (
            "email", "passwordHash", "firstName", "lastName", 
            "phone", "address", "role", "status"
        )
        VALUES ($1, $2, $3, $4, $5, $6, 'member', 'active')
        RETURNING "userId", "email", "firstName", "lastName", 
                  "phone", "address", "role", "status", "createdAt";
    `;
    const values = [
        email.trim().toLowerCase(),
        passwordHash,
        firstName.trim(),
        lastName.trim(),
        phone ? phone.trim() : null,
        address ? address.trim() : null
    ];
    const { rows } = await pool.query(query, values);
    return rows[0];
};

export const updateLastLogin = async (userId) => {
    const query = `
        UPDATE "users"
        SET "lastLoginAt" = NOW()
        WHERE "userId" = $1;
    `;
    await pool.query(query, [userId]);
};
