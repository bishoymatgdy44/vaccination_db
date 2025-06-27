import express from 'express';
import { dbConfig, sql } from '../db.js';

const router = express.Router();

// ✅ جلب الأطباء مع البحث والتقسيم (pagination)
router.get('/doctors', async (req, res) => {
  const { name, page = 1, limit = 100 } = req.query;

  const pageInt = parseInt(page);
  const limitInt = parseInt(limit);
  const offset = (pageInt - 1) * limitInt;

  const finalLimit = limitInt === 0 || isNaN(limitInt) ? 100 : limitInt;

  let query = `
    SELECT 
      [doctor_id], [name], [specialization], [phone], [clinic_location],
      [Description], [Rating], [Fees], [AvailableDays], [AvailableTimes],
      [photo]
    FROM [dbo].[Doctors]
  `;

  if (name) {
    query += ` WHERE name LIKE '%' + @name + '%'`;
  }

  query += `
    ORDER BY doctor_id
    OFFSET @offset ROWS FETCH NEXT @limit ROWS ONLY
  `;

  try {
    const pool = await sql.connect(dbConfig);
    const request = pool.request()
      .input('offset', sql.Int, offset)
      .input('limit', sql.Int, finalLimit);

    if (name) {
      request.input('name', sql.VarChar, name);
    }

    const result = await request.query(query);

    // ✅ تعديل النتائج لإضافة رابط الصورة الكامل
    const updatedDoctors = result.recordset.map(doctor => ({
  ...doctor,
  image_url: doctor.photo
    ? `http://localhost:5001/uploads/${doctor.photo}`
    : null
}));


    res.status(200).json(updatedDoctors);
  } catch (err) {
    console.error('Pagination Error:', err);
    res.status(500).json({ error: 'Server error' });
  }
});

// ✅ Get single doctor by ID
router.get('/doctors/:doctorId', async (req, res) => {
  const { doctorId } = req.params;

  try {
    const pool = await sql.connect(dbConfig);
    const request = pool.request().input('doctorId', sql.Int, doctorId);

    const result = await request.query(`
      SELECT 
        [doctor_id], [name], [specialization], [phone], [clinic_location],
        [Description], [Rating], [Fees], [AvailableDays], [AvailableTimes],
        [photo]
      FROM [dbo].[Doctors]
      WHERE doctor_id = @doctorId
    `);

    if (result.recordset.length === 0) {
      return res.status(404).json({ message: "Doctor not found" });
    }

    const doctor = result.recordset[0];
    doctor.image_url = doctor.photo
      ? `http://localhost:5001/uploads/${doctor.photo}`
      : null;

    res.status(200).json(doctor);
  } catch (err) {
    console.error('Fetch doctor error:', err);
    res.status(500).json({ error: 'Server error' });
  }
});


// ✅ Get single doctor by name
router.get('/doctors/name/:doctorName', async (req, res) => {
  const { doctorName } = req.params;

  try {
    const pool = await sql.connect(dbConfig);
    const request = pool.request().input('doctorName', sql.NVarChar, doctorName);

    const result = await request.query(`
      SELECT 
        [doctor_id], [name], [specialization], [phone], [clinic_location],
        [Description], [Rating], [Fees], [AvailableDays], [AvailableTimes],
        [photo]
      FROM [dbo].[Doctors]
      WHERE name = @doctorName
    `);

    if (result.recordset.length === 0) {
      return res.status(404).json({ message: "Doctor not found" });
    }

    const doctor = result.recordset[0];
    doctor.image_url = doctor.photo
      ? `http://localhost:5001/uploads/${doctor.photo}`
      : null;

    res.status(200).json(doctor);
  } catch (err) {
    console.error('Fetch doctor by name error:', err);
    res.status(500).json({ error: 'Server error' });
  }
});


export default router;
