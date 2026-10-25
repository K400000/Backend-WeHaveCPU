import bcrypt from 'bcrypt';
import database from '../config/db.js';
import * as userService from '../services/userService.js';

// 1. ดูข้อมูลโปรไฟล์ของตนเอง
export async function getProfile(req, res) {
    try {
        const userId = req.user?.userId;
        if (!userId) {
            return res.status(401).json({ message: 'Unauthorized' });
        }

        const strQry = `
            SELECT "userId", "email", "firstName", "lastName", 
                   "phone", "address", "avatarUrl", "role", "status", 
                   "createdAt", "updatedAt", "lastLoginAt"
            FROM "users"
            WHERE "userId" = $1
            LIMIT 1;
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

// 2. แก้ไขข้อมูลโปรไฟล์ (ชื่อ, นามสกุล, เบอร์โทร, ที่อยู่, รูปโปรไฟล์)
export async function updateProfile(req, res) {
    try {
        const userId = req.user?.userId;
        if (!userId) {
            return res.status(401).json({ message: 'Unauthorized' });
        }

        const { firstName, lastName, phone, address } = req.body;
        let avatarUrl = req.body.avatarUrl;

        // หากมีการอัปโหลดไฟล์รูปภาพผ่าน Multer
        if (req.file) {
            avatarUrl = `/uploads/profiles/${req.file.filename}`;
        }

        if (firstName !== undefined && !firstName.trim()) {
            return res.status(400).json({ message: 'First name cannot be empty' });
        }

        if (lastName !== undefined && !lastName.trim()) {
            return res.status(400).json({ message: 'Last name cannot be empty' });
        }

        const strQry = `
            UPDATE "users"
            SET 
                "firstName" = COALESCE($1, "firstName"),
                "lastName" = COALESCE($2, "lastName"),
                "phone" = COALESCE($3, "phone"),
                "address" = COALESCE($4, "address"),
                "avatarUrl" = COALESCE($5, "avatarUrl"),
                "updatedAt" = NOW()
            WHERE "userId" = $6
            RETURNING "userId", "email", "firstName", "lastName", 
                      "phone", "address", "avatarUrl", "role", "status", 
                      "createdAt", "updatedAt", "lastLoginAt";
        `;
        const values = [
            firstName ? firstName.trim() : null,
            lastName ? lastName.trim() : null,
            phone !== undefined ? (phone ? phone.trim() : null) : null,
            address !== undefined ? (address ? address.trim() : null) : null,
            avatarUrl !== undefined ? (avatarUrl ? avatarUrl.trim() : null) : null,
            userId
        ];

        const result = await database.query(strQry, values);
        const updatedUser = result.rows[0];

        if (!updatedUser) {
            return res.status(404).json({ message: 'User not found' });
        }

        return res.status(200).json({
            message: 'Profile updated successfully',
            user: updatedUser
        });
    } catch (err) {
        return res.status(500).json({ message: err.message });
    }
}

// 3. เปลี่ยนรหัสผ่าน
export async function changePassword(req, res) {
    try {
        const userId = req.user?.userId;
        if (!userId) {
            return res.status(401).json({ message: 'Unauthorized' });
        }

        const { oldPassword, currentPassword, newPassword } = req.body;
        const currentPwd = oldPassword || currentPassword;

        if (!currentPwd || !newPassword) {
            return res.status(400).json({ message: 'Current password and new password are required' });
        }

        if (newPassword.length < 6) {
            return res.status(400).json({ message: 'New password must be at least 6 characters' });
        }

        if (currentPwd === newPassword) {
            return res.status(400).json({ message: 'New password cannot be the same as current password' });
        }

        // ดึง hash รหัสผ่านเดิมมาตรวจสอบ
        const findQry = `SELECT "passwordHash" FROM "users" WHERE "userId" = $1 LIMIT 1;`;
        const userRes = await database.query(findQry, [userId]);
        const user = userRes.rows[0];

        if (!user) {
            return res.status(404).json({ message: 'User not found' });
        }

        const isMatch = await bcrypt.compare(currentPwd, user.passwordHash);
        if (!isMatch) {
            return res.status(400).json({ message: 'Incorrect current password' });
        }

        // เข้ารหัสรหัสผ่านใหม่
        const newPasswordHash = await bcrypt.hash(newPassword, 10);

        const updateQry = `
            UPDATE "users"
            SET "passwordHash" = $1, "updatedAt" = NOW()
            WHERE "userId" = $2;
        `;
        await database.query(updateQry, [newPasswordHash, userId]);

        return res.status(200).json({ message: 'Password changed successfully' });
    } catch (err) {
        return res.status(500).json({ message: err.message });
    }
}

function parseUserId(value) {
    return /^\d+$/.test(value) ? parseInt(value, 10) : null;
}

// 4. [Admin] รายการผู้ใช้ทั้งหมด (กรอง status/role, ค้นหา, แบ่งหน้า)
export async function adminGetUsers(req, res) {
    try {
        const { status, role } = req.query;
        const search = req.query.search?.trim() || null;
        const page = parseInt(req.query.page, 10) || 1;
        const limit = Math.min(parseInt(req.query.limit, 10) || 20, 100);

        if (status && !['active', 'suspended', 'banned'].includes(status)) {
            return res.status(400).json({ message: 'Status must be one of: active, suspended, banned' });
        }

        if (role && !['member', 'admin'].includes(role)) {
            return res.status(400).json({ message: 'Role must be one of: member, admin' });
        }

        if (page < 1 || limit < 1) {
            return res.status(400).json({ message: 'page and limit must be positive integers' });
        }

        const result = await userService.adminListUsers({
            status: status || null,
            role: role || null,
            search,
            page,
            limit
        });

        return res.status(200).json(result);
    } catch (err) {
        return res.status(err.status || 500).json({ message: err.message });
    }
}

// 5. [Admin] เปลี่ยนสถานะผู้ใช้ (active / suspended / banned)
export async function adminChangeUserStatus(req, res) {
    try {
        const targetId = parseUserId(req.params.userId);
        if (!targetId) {
            return res.status(400).json({ message: 'Valid userId is required' });
        }

        const { status, reason } = req.body;
        const user = await userService.adminChangeUserStatus(targetId, req.user.userId, status, reason);

        return res.status(200).json({ message: 'User status updated successfully', user });
    } catch (err) {
        return res.status(err.status || 500).json({ message: err.message });
    }
}

// 6. [Admin] เลื่อนขั้น member เป็น admin
export async function adminPromoteUser(req, res) {
    try {
        const targetId = parseUserId(req.params.userId);
        if (!targetId) {
            return res.status(400).json({ message: 'Valid userId is required' });
        }

        const user = await userService.adminChangeUserRole(targetId, req.user.userId, 'admin');

        return res.status(200).json({ message: 'User promoted to admin successfully', user });
    } catch (err) {
        return res.status(err.status || 500).json({ message: err.message });
    }
}

// 7. [Admin] ลดสิทธิ์ admin เป็น member
export async function adminDemoteUser(req, res) {
    try {
        const targetId = parseUserId(req.params.userId);
        if (!targetId) {
            return res.status(400).json({ message: 'Valid userId is required' });
        }

        const user = await userService.adminChangeUserRole(targetId, req.user.userId, 'member');

        return res.status(200).json({ message: 'Admin demoted to member successfully', user });
    } catch (err) {
        return res.status(err.status || 500).json({ message: err.message });
    }
}
