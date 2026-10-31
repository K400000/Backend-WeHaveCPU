import bcrypt from 'bcrypt';
import jwt from 'jsonwebtoken';
import database from '../config/db.js';

const SECRET_KEY = process.env.SECRET_KEY || process.env.JWT_SECRET;

const COOKIE_OPTIONS = {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: process.env.NODE_ENV === 'production' ? 'none' : 'lax',
    maxAge: 3600000
};

export async function register(req, res) {
    try {
        const { email, password, firstName, lastName, phone, address } = req.body;

        if (!email || !password || !firstName || !lastName) {
            return res.status(400).json({ message: 'Email, password, firstName, and lastName are required' });
        }

        const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
        if (!emailRegex.test(email)) {
            return res.status(400).json({ message: 'Invalid email address format' });
        }

        if (password.length < 6) {
            return res.status(400).json({ message: 'Password must be at least 6 characters' });
        }

        // ตรวจสอบ email ซ้ำ
        const checkQry = `SELECT "userId" FROM "users" WHERE LOWER("email") = LOWER($1)`;
        const checkResult = await database.query(checkQry, [email.trim()]);
        if (checkResult.rows.length > 0) {
            return res.status(409).json({ message: 'Email is already registered' });
        }

        const passwordHash = await bcrypt.hash(password, 10);

        const strQry = `
            INSERT INTO "users" (
                "email", "passwordHash", "firstName", "lastName", 
                "phone", "address", "role", "status"
            )
            VALUES ($1, $2, $3, $4, $5, $6, 'member', 'active')
            RETURNING "userId", "email", "firstName", "lastName", 
                      "phone", "address", "role", "status", "createdAt"
        `;
        const values = [
            email.trim().toLowerCase(),
            passwordHash,
            firstName.trim(),
            lastName.trim(),
            phone ? phone.trim() : null,
            address ? address.trim() : null
        ];

        const result = await database.query(strQry, values);
        const newUser = result.rows[0];

        const token = jwt.sign(
            { userId: newUser.userId, role: newUser.role },
            SECRET_KEY,
            { expiresIn: '1h' }
        );

        res.cookie('token', token, COOKIE_OPTIONS);

        return res.status(201).json({
            message: 'User registered successfully',
            user: newUser
        });
    } catch (err) {
        return res.status(500).json({ message: err.message });
    }
}

export async function login(req, res) {
    try {
        const { email, password } = req.body;

        if (!email || !password) {
            return res.status(400).json({ message: 'Email and password are required' });
        }

        const strQry = `
            SELECT "userId", "email", "passwordHash", "firstName", "lastName", 
                   "phone", "address", "avatarUrl", "role", "status"
            FROM "users"
            WHERE LOWER("email") = LOWER($1)
        `;
        const result = await database.query(strQry, [email.trim()]);
        const user = result.rows[0];

        if (!user) {
            return res.status(401).json({ message: 'Invalid email or password' });
        }

        if (user.status === 'suspended') {
            return res.status(403).json({ message: 'Your account has been suspended' });
        }

        if (user.status === 'banned') {
            return res.status(403).json({ message: 'Your account has been banned' });
        }

        const isMatch = await bcrypt.compare(password, user.passwordHash);
        if (!isMatch) {
            return res.status(401).json({ message: 'Invalid email or password' });
        }

        const updateQry = `UPDATE "users" SET "lastLoginAt" = NOW() WHERE "userId" = $1`;
        await database.query(updateQry, [user.userId]);

        const token = jwt.sign(
            { userId: user.userId, role: user.role },
            SECRET_KEY,
            { expiresIn: '1h' }
        );

        res.cookie('token', token, COOKIE_OPTIONS);

        const { passwordHash, ...userData } = user;

        return res.status(200).json({
            message: 'Logged in successfully',
            user: userData
        });
    } catch (err) {
        return res.status(500).json({ message: err.message });
    }
}

export async function logout(req, res) {
    try {
        res.clearCookie('token', COOKIE_OPTIONS);
        return res.status(200).json({ message: 'Logged out successfully' });
    } catch (err) {
        return res.status(500).json({ message: err.message });
    }
}

export async function getMe(req, res) {
    try {
        const userId = req.user?.userId;
        if (!userId) {
            return res.status(401).json({ message: 'Unauthorized' });
        }

        const strQry = `
            SELECT "userId", "email", "firstName", "lastName", 
                   "phone", "address", "avatarUrl", "role", "status", 
                   "createdAt", "lastLoginAt"
            FROM "users"
            WHERE "userId" = $1
        `;
        const result = await database.query(strQry, [userId]);
        const user = result.rows[0];

        if (!user) {
            return res.status(404).json({ message: 'User not found' });
        }

        return res.status(200).json(user);
    } catch (err) {
        return res.status(500).json({ message: err.message });
    }
}