import express from 'express';
import { dbConfig } from '../db.js'; 
import { sql } from '../db.js';

const router = express.Router();

// ✅ مسار: جلب اللقاحات مع البحث والتقسيم إلى صفحات
router.get('/vaccines', async (req, res) => {
  const { Vaccines_name, page = 1, limit = 100} = req.query;

  const pageInt = parseInt(page);
  const limitInt = parseInt(limit);
  const offset = (pageInt - 1) * limitInt;

  // 🟡 قاعدة الاستعلام الأساسية
  let query = `
    SELECT [vaccine_id], [Vaccines_name], [description], [age_range], [required_doses]
    FROM [dbo].[Vaccines]
  `;

  // ✅ إضافة شرط البحث إذا تم توفير الاسم
  if (Vaccines_name) {
    query += ` WHERE [Vaccines_name] LIKE '%' + @Vaccines_name + '%'`;
  }

  // ✅ إضافة الترتيب والتقسيم إلى صفحات
  query += `
    ORDER BY vaccine_id
    OFFSET @offset ROWS FETCH NEXT @limit ROWS ONLY
  `;

  try {
    const pool = await sql.connect(dbConfig);
    const request = pool.request()
      .input('offset', sql.Int, offset)
      .input('limit', sql.Int, limitInt);

    if (Vaccines_name) {
      request.input('Vaccines_name', sql.VarChar, Vaccines_name);
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
