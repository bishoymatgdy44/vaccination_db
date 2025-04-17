import express from 'express';
import { dbConfig } from '../db.js'; 
import { sql, } from '../db.js';

const router = express.Router();

// ✅ مسار: جلب اللقاحات مع البحث والتقسيم إلى صفحات
router.get('/vaccines', async (req, res) => {
  const { name, page = 1, limit = 10 } = req.query;

  const pageInt = parseInt(page);
  const limitInt = parseInt(limit);
  const offset = (pageInt - 1) * limitInt;

  let query = `
    SELECT [vaccine_id], [name], [description], [age_range], [required_doses]
    FROM [dbo].[Vaccines]
  `;

  if (name) {
    query += ` WHERE name LIKE '%' + @name + '%'`;
  }

  query += `
    ORDER BY vaccine_id
    OFFSET @offset ROWS FETCH NEXT @limit ROWS ONLY
  `;

  try {
    const pool = await sql.connect(dbConfig);
    const request = pool.request()
      .input('offset', sql.Int, offset)
      .input('limit', sql.Int, limitInt);

    if (name) {
      request.input('name', sql.VarChar, name);
    }

    const result = await request.query(query);
    res.status(200).json(result.recordset);
  } catch (err) {
    console.error('Pagination Error:', err);
    res.status(500).json({ error: 'Server error' });
  }
});

// ✅ تصدير الراوتر حتى يتم استخدامه في ملف server.js
export default router;
