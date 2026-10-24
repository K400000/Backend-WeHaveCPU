import jwt from 'jsonwebtoken';
import database from '../config/db.js';

const SECRET_KEY = process.env.SECRET_KEY || process.env.JWT_SECRET;

export async function authenticate(req, res, next) {
    try {
        let token = req.cookies?.token;

        if (!token && req.headers.authorization?.startsWith('Bearer ')) {
            token = req.headers.authorization.split(' ')[1];
        }

        if (!token) {
            return res.status(401).json({ message: 'Authentication required. Please login.' });
        }

        const decoded = jwt.verify(token, SECRET_KEY);

        const strQry = `
            SELECT "userId", "email", "firstName", "lastName", "role", "status"
            FROM "users"
            WHERE "userId" = $1
        `;
        const result = await database.query(strQry, [decoded.userId]);
        const user = result.rows[0];

        if (!user) {
            return res.status(401).json({ message: 'User no longer exists.' });
        }

        if (user.status === 'suspended') {
            return res.status(403).json({ message: 'Your account has been suspended.' });
        }

        if (user.status === 'banned') {
            return res.status(403).json({ message: 'Your account has been banned.' });
        }

        req.user = user;
        next();
    } catch (err) {
        if (err.name === 'JsonWebTokenError' || err.name === 'TokenExpiredError') {
            return res.status(401).json({ message: 'Invalid or expired token.' });
        }
        return res.status(500).json({ message: err.message });
    }
}

export default authenticate;
