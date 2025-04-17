import express from 'express';
import { sql, dbConfig } from '../db.js';

const router = express.Router();

// ✅ إضافة دكتور جديد
router.post('/', async (req, res) => {
    const { name, specialization, phone, clinic_name, clinic_location } = req.body;

    if (!name || !specialization || !phone) {
        return res.status(400).json({ message: "Missing required fields." });
    }

    try {
        const pool = await sql.connect(dbConfig);

        await pool.request()
            .input("name", sql.VarChar, name)
            .input("specialization", sql.VarChar, specialization)
            .input("phone", sql.VarChar, phone)
            .input("clinic_name", sql.VarChar, clinic_name || null)
            .input("clinic_location", sql.VarChar, clinic_location || null)
            .query(`
                INSERT INTO [dbo].[Doctors] (name, specialization, phone, clinic_name, clinic_location)
                VALUES (@name, @specialization, @phone, @clinic_name, @clinic_location)
            `);

        res.status(201).json({ message: "Doctor added successfully!" });
    } catch (error) {
        console.error("Error adding doctor:", error);
        res.status(500).json({ error: "Server error" });
    }
});

// ✅ جلب جميع الأطباء
router.get('/', async (req, res) => {
    try {
        const pool = await sql.connect(dbConfig);
        const result = await pool.request().query(`
            SELECT doctor_id, name, specialization, phone, clinic_name, clinic_location
            FROM [dbo].[Doctors]
        `);
        res.status(200).json(result.recordset);
    } catch (error) {
        console.error("Error fetching doctors:", error);
        res.status(500).json({ error: "Server error" });
    }
});

export default router;
