import database from '../config/db.js';

// 1. ดึงข้อมูลสรุปภาพรวม Dashboard (Summary Cards)
export async function getDashboardSummary(req, res) {
    try {
        let summaryData = null;

        // ดึงจาก view vDashboardSummary ถ้ามี
        try {
            const viewResult = await database.query(`SELECT * FROM "vDashboardSummary" LIMIT 1;`);
            if (viewResult.rows.length > 0) {
                summaryData = viewResult.rows[0];
            }
        } catch {
            // คำนวณตรงจาก orders หากยังไม่ได้สร้าง view
            const fallbackQry = `
                SELECT
                    COUNT(*) FILTER (
                        WHERE "status" IN ('pending', 'paid', 'shipped', 'completed')
                        AND ("createdAt" AT TIME ZONE 'Asia/Bangkok')::date = (NOW() AT TIME ZONE 'Asia/Bangkok')::date
                    )::int AS "ordersToday",

                    COALESCE(SUM("totalAmount") FILTER (
                        WHERE "status" IN ('paid', 'shipped', 'completed')
                        AND ("paidAt" AT TIME ZONE 'Asia/Bangkok')::date = (NOW() AT TIME ZONE 'Asia/Bangkok')::date
                    ), 0)::numeric(12,2) AS "salesToday",

                    COUNT(*) FILTER (
                        WHERE "status" IN ('pending', 'paid', 'shipped', 'completed')
                        AND DATE_TRUNC('month', "createdAt" AT TIME ZONE 'Asia/Bangkok') = DATE_TRUNC('month', NOW() AT TIME ZONE 'Asia/Bangkok')
                    )::int AS "ordersThisMonth",

                    COALESCE(SUM("totalAmount") FILTER (
                        WHERE "status" IN ('paid', 'shipped', 'completed')
                        AND DATE_TRUNC('month', "paidAt" AT TIME ZONE 'Asia/Bangkok') = DATE_TRUNC('month', NOW() AT TIME ZONE 'Asia/Bangkok')
                    ), 0)::numeric(12,2) AS "salesThisMonth",

                    COUNT(*) FILTER (
                        WHERE "status" IN ('pending', 'paid', 'shipped', 'completed')
                        AND DATE_TRUNC('year', "createdAt" AT TIME ZONE 'Asia/Bangkok') = DATE_TRUNC('year', NOW() AT TIME ZONE 'Asia/Bangkok')
                    )::int AS "ordersThisYear",

                    COALESCE(SUM("totalAmount") FILTER (
                        WHERE "status" IN ('paid', 'shipped', 'completed')
                        AND DATE_TRUNC('year', "paidAt" AT TIME ZONE 'Asia/Bangkok') = DATE_TRUNC('year', NOW() AT TIME ZONE 'Asia/Bangkok')
                    ), 0)::numeric(12,2) AS "salesThisYear",

                    COUNT(*) FILTER (
                        WHERE "status" IN ('pending', 'paid', 'shipped', 'completed')
                    )::int AS "ordersAll",

                    COALESCE(SUM("totalAmount") FILTER (
                        WHERE "status" IN ('paid', 'shipped', 'completed')
                    ), 0)::numeric(12,2) AS "salesAll"
                FROM "orders";
            `;
            const fallbackResult = await database.query(fallbackQry);
            summaryData = fallbackResult.rows[0];
        }

        // ดึงสถิติจำนวนสมาชิก
        const userQry = `
            SELECT 
                COUNT(*)::int AS "totalUsers",
                COUNT(*) FILTER (WHERE "status" = 'active')::int AS "activeUsers"
            FROM "users"
            WHERE "role" = 'member';
        `;
        const userResult = await database.query(userQry);

        // ดึงสถิติจำนวนสินค้าและสินค้าหมด
        const productQry = `
            SELECT 
                COUNT(*)::int AS "totalProducts",
                COUNT(*) FILTER (WHERE "stock" = 0)::int AS "outOfStockProducts"
            FROM "products"
            WHERE "deletedAt" IS NULL;
        `;
        const productResult = await database.query(productQry);

        // ดึงจำนวนคำสั่งซื้อแยกตามสถานะ
        const orderStatusQry = `
            SELECT 
                "status",
                COUNT(*)::int AS "count"
            FROM "orders"
            WHERE "status" != 'cart'
            GROUP BY "status";
        `;
        const orderStatusResult = await database.query(orderStatusQry);

        const orderStatusCount = {
            pending: 0,
            paid: 0,
            shipped: 0,
            completed: 0,
            cancelled: 0
        };

        orderStatusResult.rows.forEach(row => {
            if (orderStatusCount[row.status] !== undefined) {
                orderStatusCount[row.status] = row.count;
            }
        });

        return res.status(200).json({
            summary: {
                today: {
                    orders: Number(summaryData?.ordersToday) || 0,
                    sales: Number(summaryData?.salesToday) || 0
                },
                thisMonth: {
                    orders: Number(summaryData?.ordersThisMonth) || 0,
                    sales: Number(summaryData?.salesThisMonth) || 0
                },
                thisYear: {
                    orders: Number(summaryData?.ordersThisYear) || 0,
                    sales: Number(summaryData?.salesThisYear) || 0
                },
                allTime: {
                    orders: Number(summaryData?.ordersAll) || 0,
                    sales: Number(summaryData?.salesAll) || 0
                }
            },
            overview: {
                totalUsers: userResult.rows[0]?.totalUsers || 0,
                activeUsers: userResult.rows[0]?.activeUsers || 0,
                totalProducts: productResult.rows[0]?.totalProducts || 0,
                outOfStockProducts: productResult.rows[0]?.outOfStockProducts || 0,
                ordersByStatus: orderStatusCount
            }
        });
    } catch (err) {
        return res.status(500).json({ message: err.message });
    }
}

// 2. ดึงข้อมูลกราฟยอดขายและจำนวนคำสั่งซื้อแยกตาม วัน / เดือน / ปี
export async function getDashboardCharts(req, res) {
    try {
        const { period = 'day' } = req.query;

        let strQry = '';

        if (period === 'year') {
            // ย้อนหลัง 5 ปี
            strQry = `
                WITH year_series AS (
                    SELECT generate_series(
                        DATE_TRUNC('year', (NOW() AT TIME ZONE 'Asia/Bangkok') - INTERVAL '4 years'),
                        DATE_TRUNC('year', NOW() AT TIME ZONE 'Asia/Bangkok'),
                        '1 year'::interval
                    )::date AS "periodYear"
                )
                SELECT 
                    TO_CHAR(ys."periodYear", 'YYYY') AS "label",
                    COUNT(o."orderId") FILTER (WHERE o."status" IN ('pending', 'paid', 'shipped', 'completed'))::int AS "orders",
                    COALESCE(SUM(o."totalAmount") FILTER (WHERE o."status" IN ('paid', 'shipped', 'completed')), 0)::numeric(12,2) AS "sales"
                FROM year_series ys
                LEFT JOIN "orders" o ON DATE_TRUNC('year', o."createdAt" AT TIME ZONE 'Asia/Bangkok') = ys."periodYear"
                GROUP BY ys."periodYear"
                ORDER BY ys."periodYear" ASC;
            `;
        } else if (period === 'month') {
            // ย้อนหลัง 12 เดือน
            strQry = `
                WITH month_series AS (
                    SELECT generate_series(
                        DATE_TRUNC('month', (NOW() AT TIME ZONE 'Asia/Bangkok') - INTERVAL '11 months'),
                        DATE_TRUNC('month', NOW() AT TIME ZONE 'Asia/Bangkok'),
                        '1 month'::interval
                    )::date AS "periodMonth"
                )
                SELECT 
                    TO_CHAR(ms."periodMonth", 'YYYY-MM') AS "label",
                    COUNT(o."orderId") FILTER (WHERE o."status" IN ('pending', 'paid', 'shipped', 'completed'))::int AS "orders",
                    COALESCE(SUM(o."totalAmount") FILTER (WHERE o."status" IN ('paid', 'shipped', 'completed')), 0)::numeric(12,2) AS "sales"
                FROM month_series ms
                LEFT JOIN "orders" o ON DATE_TRUNC('month', o."createdAt" AT TIME ZONE 'Asia/Bangkok') = ms."periodMonth"
                GROUP BY ms."periodMonth"
                ORDER BY ms."periodMonth" ASC;
            `;
        } else {
            // default: day (ย้อนหลัง 30 วัน)
            strQry = `
                WITH date_series AS (
                    SELECT generate_series(
                        (NOW() AT TIME ZONE 'Asia/Bangkok')::date - INTERVAL '29 days',
                        (NOW() AT TIME ZONE 'Asia/Bangkok')::date,
                        '1 day'::interval
                    )::date AS "periodDate"
                )
                SELECT 
                    TO_CHAR(ds."periodDate", 'YYYY-MM-DD') AS "label",
                    COUNT(o."orderId") FILTER (WHERE o."status" IN ('pending', 'paid', 'shipped', 'completed'))::int AS "orders",
                    COALESCE(SUM(o."totalAmount") FILTER (WHERE o."status" IN ('paid', 'shipped', 'completed')), 0)::numeric(12,2) AS "sales"
                FROM date_series ds
                LEFT JOIN "orders" o ON (o."createdAt" AT TIME ZONE 'Asia/Bangkok')::date = ds."periodDate"
                GROUP BY ds."periodDate"
                ORDER BY ds."periodDate" ASC;
            `;
        }

        const result = await database.query(strQry);

        return res.status(200).json({
            period,
            data: result.rows.map(row => ({
                label: row.label,
                orders: Number(row.orders) || 0,
                sales: Number(row.sales) || 0
            }))
        });
    } catch (err) {
        return res.status(500).json({ message: err.message });
    }
}
