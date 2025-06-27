import express from 'express';
import { sql, dbConfig } from '../db.js';
import { DateTime } from 'luxon';
const router = express.Router();

// حذف الحجوزات القديمة تلقائيًا عند استدعاء أي عملية
const deleteOldBookings = async () => {
  try {
    const pool = await sql.connect(dbConfig);
    await pool.request().query(`
      DELETE FROM doctors_booking
      WHERE
        appointment_date < CAST(GETDATE() AS DATE)
        OR (appointment_date = CAST(GETDATE() AS DATE) AND appointment_time < CAST(GETDATE() AS TIME))
    `);
  } catch (error) {
    console.error('Error deleting old bookings:', error);
  }
};


// إضافة حجز جديد
router.post('/doctors_booking', async (req, res) => {
  await deleteOldBookings();

  try {
    const {
      patient_email,
      doctor_name,
      appointment_date,
      appointment_time,
      birth_date,
      patient_name,
      patient_phone,
      patient_gender,
    } = req.body;

    if (!patient_email || !doctor_name || !appointment_date || !appointment_time || !birth_date || !patient_name || !patient_phone || !patient_gender) {
      return res.status(400).json({ error: 'All fields are required.' });
    }

    // التحقق من أن جميع الحقول مكتوبة بالإنجليزية فقط
    const englishRegex = /^[\x00-\x7F\s@.]+$/;
    if (
      !englishRegex.test(patient_name) ||
      !englishRegex.test(patient_phone) ||
      !englishRegex.test(patient_email) ||
      !englishRegex.test(patient_gender)
    ) {
      return res.status(400).json({ error: 'Please enter all fields in English only.' });
    }

    const pool = await sql.connect(dbConfig);

    // جلب patient_id من جدول patient باستخدام البريد الإلكتروني
    const patientResult = await pool.request()
      .input('email', sql.VarChar, patient_email)
      .query('SELECT patient_id FROM patient WHERE email = @email');

    if (patientResult.recordset.length === 0) {
      return res.status(404).json({ error: 'Patient email not found.' });
    }

    const patient_id = patientResult.recordset[0].patient_id;

    const time = new Date(`1970-01-01 ${appointment_time}`);

    // وقت مصر الحالي
    const now = DateTime.now().setZone('Africa/Cairo');

    // وقت الحجز
    const bookingDateTime = DateTime.fromISO(`${appointment_date} ${appointment_time}, { zone: 'Africa/Cairo' }`);

    if (bookingDateTime < now) {
      return res.status(400).json({ error: 'Booking date and time must be in the future.' });
    }

    // التحقق من وجود حجز مسبق لنفس المريض مع نفس الدكتور
    const existing = await pool.request()
      .input('patient_id', sql.Int, patient_id)
      .input('doctor_name', sql.NVarChar, doctor_name)
      .query(`
        SELECT * FROM doctors_booking 
        WHERE patient_id = @patient_id AND doctor_name = @doctor_name
      `);
    if (existing.recordset.length > 0) {
      return res.status(409).json({ error: 'This patient already has a booking with this doctor.' });
    }

    // التحقق من وجود حجز لنفس المريض مع دكتور آخر في نفس الوقت
    const timeConflict = await pool.request()
      .input('patient_id', sql.Int, patient_id)
      .input('appointment_date', sql.Date, appointment_date)
      .input('appointment_time', sql.Time, time)
      .query(`
        SELECT * FROM doctors_booking 
        WHERE patient_id = @patient_id 
        AND appointment_date = @appointment_date 
        AND appointment_time = @appointment_time
      `);
    if (timeConflict.recordset.length > 0) {
      return res.status(409).json({ error: 'This patient already has a booking at this time with another doctor.' });
    }

    // التحقق من عدم وجود حجز آخر لنفس الدكتور خلال 15 دقيقة
    const checkConflict = await pool.request()
      .input('doctor_name', sql.NVarChar, doctor_name)
      .input('appointment_date', sql.Date, appointment_date)
      .input('appointment_time', sql.Time, time)
      .query(`
        SELECT appointment_time FROM doctors_booking 
        WHERE doctor_name = @doctor_name
        AND appointment_date = @appointment_date 
        AND ABS(DATEDIFF(MINUTE, appointment_time, @appointment_time)) < 15
      `);
    if (checkConflict.recordset.length > 0) {
      const latest = checkConflict.recordset.map(r => r.appointment_time).sort().pop();
      const suggested = new Date(`1970-01-01 ${latest}`);
      suggested.setMinutes(suggested.getMinutes() + 15);

      const options = { hour: 'numeric', minute: '2-digit', hour12: true, timeZone: 'Africa/Cairo' };
      const suggestion = suggested.toLocaleTimeString('en-US', options);

      return res.status(409).json({
        error: 'The doctor already has an appointment in 15 minutes.',
        suggestion
      });
    }

    // الوقت الحالي لحظة الحجز
    const createdAt = new Date();

    // تنسيق created_at لعرضه بتوقيت مصر وبنظام 12 ساعة
    const formattedCreatedAt = createdAt.toLocaleString('en-US', {
      year: 'numeric',
      month: 'numeric',
      day: 'numeric',
      hour: 'numeric',
      minute: '2-digit',
      second: '2-digit',
      hour12: true,
      timeZone: 'Africa/Cairo'
    });

    // تنفيذ عملية الحجز
    await pool.request()
      .input('patient_id', sql.Int, patient_id)
      .input('doctor_name', sql.NVarChar, doctor_name)
      .input('appointment_date', sql.Date, appointment_date)
      .input('appointment_time', sql.Time, time)
      .input('birth_date', sql.Date, birth_date)
      .input('patient_name', sql.NVarChar, patient_name)
      .input('patient_phone', sql.VarChar, patient_phone)
      .input('patient_email', sql.VarChar, patient_email)
      .input('patient_gender', sql.VarChar, patient_gender)
      .input('created_at', sql.DateTime, createdAt)
      .query(`
        INSERT INTO doctors_booking (
          patient_id, doctor_name, appointment_date, appointment_time,
          birth_date, patient_name, patient_phone, patient_email, patient_gender, created_at
        ) VALUES (
          @patient_id, @doctor_name, @appointment_date, @appointment_time,
          @birth_date, @patient_name, @patient_phone, @patient_email, @patient_gender, @created_at
        )
      `);

    // الرد على المستخدم
    res.status(201).json({
      message: 'Booking created successfully.',
      created_at: formattedCreatedAt
    });
  } catch (error) {
    console.error('Create Booking Error:', error);
    res.status(500).json({ error: 'An error occurred while creating the booking.' });
  }
});


// ✅ تعديل أي بيانات بالحجز باستخدام اسم المريض
// router.patch('/doctors_booking/name/:name', async (req, res) => {
//   try {
//     const { name } = req.params;
//     const {
//       appointment_date,
//       appointment_time,
//       birth_date,
//       patient_phone,
//       patient_email,
//       patient_gender
//     } = req.body;

//     const pool = await sql.connect(dbConfig);
//     const request = pool.request();

//     request.input('patient_name', sql.NVarChar, name);

//     const fieldsToUpdate = [];

//     if (appointment_date) {
//       fieldsToUpdate.push('appointment_date = @appointment_date');
//       request.input('appointment_date', sql.Date, appointment_date);
//     }

//     if (appointment_time) {
//       // تحويل الوقت إلى صيغة صالحة لـ SQL Server
//       const time = new Date(`1970-01-01T${appointment_time}:00`);
//       fieldsToUpdate.push('appointment_time = @appointment_time');
//       request.input('appointment_time', sql.Time, time);
//     }

//     if (birth_date) {
//       fieldsToUpdate.push('birth_date = @birth_date');
//       request.input('birth_date', sql.Date, birth_date);
//     }

//     if (patient_phone) {
//       fieldsToUpdate.push('patient_phone = @patient_phone');
//       request.input('patient_phone', sql.VarChar, patient_phone);
//     }

//     if (patient_email !== undefined) {
//       fieldsToUpdate.push('patient_email = @patient_email');
//       request.input('patient_email', sql.VarChar, patient_email);
//     }

//     if (patient_gender) {
//       fieldsToUpdate.push('patient_gender = @patient_gender');
//       request.input('patient_gender', sql.VarChar, patient_gender);
//     }

//     // لو مفيش أي حاجة تتعدل
//     if (fieldsToUpdate.length === 0) {
//       return res.status(400).json({ error: 'No fields provided for update.' });
//     }

//     const query = `
//       UPDATE doctors_booking
//       SET ${fieldsToUpdate.join(', ')}
//       WHERE patient_name = @patient_name
//     `;

//     await request.query(query);

//     res.json({ message: 'Booking updated successfully.' });
//   } catch (error) {
//     console.error('Update Booking Error:', error);
//     res.status(500).json({ error: 'An error occurred while updating the booking.' });
//   }
// });


// ❌ كان يحذف باستخدام عمود غير صحيح id
// ✅ الكود المصحَّح يحذف باستخدام doctor_booking_id
router.delete('/doctors_booking/:id', async (req, res) => {
  try {
    const rawId = req.params.id;
    const id = parseInt(rawId, 10);        // نحول لقيمة رقمية

    // ✅ التحقق من صحة المُعرِّف
    if (!id) {
      return res.status(400).json({
        success: false,
        error: "Valid booking ID is required"
      });
    }

    // ✅ الاتصال بقاعدة البيانات
    const pool = await sql.connect(dbConfig);

    // ✅ تنفيذ الحذف باستخدام العمود الصحيح
    const result = await pool.request()
      .input('id', sql.Int, id)
      .query(`
        DELETE FROM doctors_booking
        WHERE doctor_booking_id = @id
      `);

    // ✅ التحقق من تأثُّر الصفوف
    if (result.rowsAffected[0] === 0) {
      return res.status(404).json({
        success: false,
        error: "Booking not found"
      });
    }

    // ✅ استجابة النجاح
    res.status(200).json({
      success: true,
      message: "Booking deleted successfully"
    });

  } catch (error) {
    // ▶ اطبع رسالة الخطأ كاملة لتشخيص المشكلة
    console.error("Delete error:", error);

    // 🔸 إذا احتجت لرسالة SQL أدق:
    // console.error(error.originalError?.info?.message);

    res.status(500).json({
      success: false,
      error: "Internal server error"
    });
  }
});



// ✅ عرض جميع الحجوزات بتنسيق Cairo ووقت 12 ساعة + ثواني
router.get('/doctors_booking', async (req, res) => {
  try {
    await deleteOldBookings();

    const pool = await sql.connect(dbConfig);
    const result = await pool.request().query('SELECT * FROM doctors_booking ORDER BY appointment_date, appointment_time');

    const formatted = result.recordset.map(row => {
      const timeOptions = {
        hour: 'numeric',
        minute: '2-digit',
        hour12: true,
        timeZone: 'Africa/Cairo'
      };

      // تحويل وقت الحجز بشكل آمن
      const timeStr = row.appointment_time instanceof Date
        ? row.appointment_time.toLocaleTimeString('en-US', timeOptions)
        : new Date(`1970-01-01T${row.appointment_time}`).toLocaleTimeString('en-US', timeOptions);

      // تحويل وقت الإنشاء
      const createdAt = new Date(row.created_at).toLocaleString('en-US', {
        year: 'numeric',
        month: 'numeric',
        day: 'numeric',
        hour: 'numeric',
        minute: '2-digit',
        second: '2-digit',
        hour12: true,
        timeZone: 'Africa/Cairo'
      });

      return {
        ...row,
        birth_date: row.birth_date.toISOString().split('T')[0], // ✅ السطر الجديد
        appointment_date: row.appointment_date.toISOString().split('T')[0],
        appointment_time: timeStr,
        created_at: createdAt
      };
    });

    res.json(formatted);
  } catch (error) {
    console.error('Get Bookings Error:', error);
    res.status(500).json({ error: 'An error occurred while fetching bookings.' });
  }
});


// ✅ عرض الحجوزات باستخدام اسم المريض بنفس التنسيق
// router.get('/doctors_booking/name/:name', async (req, res) => {
//   try {
//     const { name } = req.params;

//     const pool = await sql.connect(dbConfig);
//     const result = await pool.request()
//       .input('patient_name', sql.NVarChar, name)
//       .query(`
//         SELECT * FROM doctors_booking 
//         WHERE patient_name = @patient_name 
//         ORDER BY appointment_date, appointment_time
//       `);

//     const formatted = result.recordset.map(row => {
//       const timeOptions = {
//         hour: 'numeric',
//         minute: '2-digit',
//         second: '2-digit',
//         hour12: true,
//         timeZone: 'Africa/Cairo'
//       };

//       // معالجة الوقت بشكل مرن
//       let timeStr = 'Invalid Time';
//       if (row.appointment_time instanceof Date) {
//         timeStr = row.appointment_time.toLocaleTimeString('en-US', timeOptions);
//       } else if (typeof row.appointment_time === 'string') {
//         const [hour, minute, second] = row.appointment_time.split(':');
//         const tempTime = new Date(1970, 0, 1, hour, minute, second);
//         timeStr = tempTime.toLocaleTimeString('en-US', timeOptions);
//       }

//       const createdAt = new Date(row.created_at).toLocaleString('en-US', {
//         year: 'numeric',
//         month: 'numeric',
//         day: 'numeric',
//         hour: 'numeric',
//         minute: '2-digit',
//         second: '2-digit',
//         hour12: true,
//         timeZone: 'Africa/Cairo'
//       });

//       return {
//         ...row,
//         birth_date: row.birth_date.toISOString().split('T')[0], // ✅ السطر الجديد
//         appointment_date: row.appointment_date.toISOString().split('T')[0],
//         appointment_time: timeStr,
//         created_at: createdAt
//       };
//     });

//     res.json(formatted);
//   } catch (error) {
//     console.error('Get Bookings By Name Error:', error);
//     res.status(500).json({ error: 'An error occurred while fetching bookings by name.' });
//   }
// });


// ✅ route لجلب كل حجوزات مريض بواسطة بريده الإلكترونى
router.get('/doctors_booking/email/:email', async (req, res) => {
  try {

    const email = req.params.email?.trim();
    if (!email) {
      return res.status(400).json({
        success: false,
        error: 'Email is required'
      });
    }

    const pool = await sql.connect(dbConfig);
    const result = await pool.request()
      .input('email', sql.VarChar(255), email)
      .query(`
        SELECT
          doctor_booking_id      AS id,      -- المفتاح الأساسى
          patient_name,
          patient_email,
          doctor_name,
          appointment_date,                 -- نوع DATE
          appointment_time,                 -- نوع TIME
          created_at                        -- نوع DATETIME
        FROM doctors_booking
        WHERE patient_email = @email
        ORDER BY created_at DESC
      `);

    const timeOptions = {
      hour:   'numeric',
      minute: '2-digit',
      second: '2-digit',   // إظهار الثواني
      hour12: true,
      timeZone: 'Africa/Cairo'
    };

    const formatted = result.recordset.map(row => {
      // تحويل appointment_time إلى نص 12-hour
      const aptTime = row.appointment_time instanceof Date
        ? row.appointment_time.toLocaleTimeString('en-US', timeOptions)
        : new Date(`1970-01-01T${row.appointment_time}`)
            .toLocaleTimeString('en-US', timeOptions);

      // تنسيق created_at
      const createdAt = new Date(row.created_at).toLocaleString('en-US', {
        year:   'numeric',
        month:  '2-digit',
        day:    '2-digit',
        hour:   'numeric',
        minute: '2-digit',
        second: '2-digit',
        hour12: true,
        timeZone: 'Africa/Cairo'
      });

      return {
        id:             row.id,
        patient_name:   row.patient_name,
        patient_email:  row.patient_email,
        doctor_name:    row.doctor_name,
        appointment_date: row.appointment_date.toISOString().split('T')[0],
        appointment_time: aptTime,
        created_at:       createdAt
      };
    });

    return res.status(200).json({
      success: true,
      data: formatted
    });

  } catch (error) {

    console.error('Fetch bookings by email error:', error);

    return res.status(500).json({
      success: false,
      error: 'Internal server error'
    });
  }
});



router.patch('/doctors_booking/:id', async (req, res) => {
  try {
    // 🆔 استخراج المعرّف
    const id = parseInt(req.params.id, 10);

    // 📥 استخراج البيانات المرسلة
    const { appointment_date, appointment_time } = req.body;

    // ⚠ التحقق من الحقول الإلزامية
    if (!id || !appointment_date || !appointment_time) {
      return res.status(400).json({
        success: false,
        error: 'Missing required fields'
      });
    }

    // ⏱ تحويل الوقت لصيغة HH:mm:ss (24-ساعة)
    const sqlTime = toSqlTime(appointment_time);
    if (!sqlTime) {
      return res.status(400).json({
        success: false,
        error: 'Invalid time format. Use HH:mm, HH:mm:ss or HH:mm AM/PM'
      });
    }

    // 🔗 الاتصال بقاعدة البيانات وتنفيذ التحديث
    const pool   = await sql.connect(dbConfig);
    const result = await pool.request()
      .input('id',   sql.Int,       id)
      .input('date', sql.Date,      appointment_date) // YYYY-MM-DD
      .input('time', sql.VarChar(8), sqlTime)         // HH:mm:ss
      .query(`
        UPDATE doctors_booking
        SET appointment_date = @date,
            appointment_time = @time
        WHERE doctor_booking_id = @id
      `);

    // 🧐 التحقق: هل وُجد الحجز؟
    if (result.rowsAffected[0] === 0) {
      return res.status(404).json({
        success: false,
        error: 'Booking not found'
      });
    }

    // 🎉 تمّ التعديل بنجاح
    return res.status(200).json({
      success: true,
      message: 'Booking updated successfully'
    });

  } catch (error) {
    // 🔴 طباعة الخطأ للمطوّر
    console.error('Update error:', error);
    console.error(error.originalError?.info?.message);

    return res.status(500).json({
      success: false,
      error: 'Internal server error'
    });
  }

function toSqlTime(input) {
  if (!input) return null;

  const t = input.trim().toUpperCase();

  // 1) إن كانت HH:mm:ss جاهزة
  if (/^\d{1,2}:\d{2}:\d{2}$/.test(t)) {
    const [h, m, s] = t.split(':');
    return `${h.padStart(2, '0')}:${m}:${s}`;
  }

  // 2) إن كانت HH:mm فقط
  if (/^\d{1,2}:\d{2}$/.test(t)) {
    const [h, m] = t.split(':');
    return `${h.padStart(2, '0')}:${m}:00`;
  }

  // 3) إن كانت 12-ساعة مع AM/PM
  if (/^\d{1,2}:\d{2}(:\d{2})?\s?(AM|PM)$/.test(t)) {
    const d = new Date(`1970-01-01 ${t}`);
    if (isNaN(d)) return null;
    return d.toTimeString().slice(0, 8); // ➡ HH:mm:ss
  }

  // ⛔ صيغة غير مدعومة
  return null;
}
});


export default router;