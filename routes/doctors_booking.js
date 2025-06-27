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
router.patch('/doctors_booking/name/:name', async (req, res) => {
  try {
    const { name } = req.params;
    const {
      appointment_date,
      appointment_time,
      birth_date,
      patient_phone,
      patient_email,
      patient_gender
    } = req.body;

    const pool = await sql.connect(dbConfig);
    const request = pool.request();

    request.input('patient_name', sql.NVarChar, name);

    const fieldsToUpdate = [];

    if (appointment_date) {
      fieldsToUpdate.push('appointment_date = @appointment_date');
      request.input('appointment_date', sql.Date, appointment_date);
    }

    if (appointment_time) {
      // تحويل الوقت إلى صيغة صالحة لـ SQL Server
      const time = new Date(`1970-01-01T${appointment_time}:00`);
      fieldsToUpdate.push('appointment_time = @appointment_time');
      request.input('appointment_time', sql.Time, time);
    }

    if (birth_date) {
      fieldsToUpdate.push('birth_date = @birth_date');
      request.input('birth_date', sql.Date, birth_date);
    }

    if (patient_phone) {
      fieldsToUpdate.push('patient_phone = @patient_phone');
      request.input('patient_phone', sql.VarChar, patient_phone);
    }

    if (patient_email !== undefined) {
      fieldsToUpdate.push('patient_email = @patient_email');
      request.input('patient_email', sql.VarChar, patient_email);
    }

    if (patient_gender) {
      fieldsToUpdate.push('patient_gender = @patient_gender');
      request.input('patient_gender', sql.VarChar, patient_gender);
    }

    // لو مفيش أي حاجة تتعدل
    if (fieldsToUpdate.length === 0) {
      return res.status(400).json({ error: 'No fields provided for update.' });
    }

    const query = `
      UPDATE doctors_booking
      SET ${fieldsToUpdate.join(', ')}
      WHERE patient_name = @patient_name
    `;

    await request.query(query);

    res.json({ message: 'Booking updated successfully.' });
  } catch (error) {
    console.error('Update Booking Error:', error);
    res.status(500).json({ error: 'An error occurred while updating the booking.' });
  }
});


router.delete('/doctors_booking/:id', async (req, res) => {
  try {
    const { id } = req.params;
    
    if (!id || isNaN(id)) {
      return res.status(400).json({ 
        success: false,
        error: "Valid booking ID is required" 
      });
    }

    const pool = await sql.connect(dbConfig);
    const result = await pool.request()
      .input('id', sql.Int, id)
      .query('DELETE FROM Doctors_booking WHERE id = @id');

    if (result.rowsAffected[0] === 0) {
      return res.status(404).json({ 
        success: false,
        error: "Booking not found" 
      });
    }

    res.status(200).json({ 
      success: true,
      message: "Booking deleted successfully" 
    });
  } catch (error) {
    console.error("Delete error:", error);
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
router.get('/doctors_booking/name/:name', async (req, res) => {
  try {
    const { name } = req.params;

    const pool = await sql.connect(dbConfig);
    const result = await pool.request()
      .input('patient_name', sql.NVarChar, name)
      .query(`
        SELECT * FROM doctors_booking 
        WHERE patient_name = @patient_name 
        ORDER BY appointment_date, appointment_time
      `);

    const formatted = result.recordset.map(row => {
      const timeOptions = {
        hour: 'numeric',
        minute: '2-digit',
        second: '2-digit',
        hour12: true,
        timeZone: 'Africa/Cairo'
      };

      // معالجة الوقت بشكل مرن
      let timeStr = 'Invalid Time';
      if (row.appointment_time instanceof Date) {
        timeStr = row.appointment_time.toLocaleTimeString('en-US', timeOptions);
      } else if (typeof row.appointment_time === 'string') {
        const [hour, minute, second] = row.appointment_time.split(':');
        const tempTime = new Date(1970, 0, 1, hour, minute, second);
        timeStr = tempTime.toLocaleTimeString('en-US', timeOptions);
      }

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
    console.error('Get Bookings By Name Error:', error);
    res.status(500).json({ error: 'An error occurred while fetching bookings by name.' });
  }
});


router.get('/doctors_booking/email/:email', async (req, res) => {
  try {
    const pool = await sql.connect(dbConfig);
    const result = await pool.request()
      .input('email', sql.VarChar, req.params.email)
      .query(`
        SELECT 
          id,  // تأكد من تضمين حقل ID
          patient_name,
          patient_email,
          doctor_name,
          appointment_date,
          appointment_time,
          created_at
        FROM Doctors_booking
        WHERE patient_email = @email
        ORDER BY created_at DESC
      `);

    res.status(200).json(result.recordset);
  } catch (error) {
    console.error("Error:", error);
    res.status(500).json({ error: "Failed to fetch bookings" });
  }
});

router.patch('/doctors_booking/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const { appointment_date, appointment_time } = req.body;

    if (!id || !appointment_date || !appointment_time) {
      return res.status(400).json({ error: "Missing required fields" });
    }

    const pool = await sql.connect(dbConfig);
    const result = await pool.request()
      .input('id', sql.Int, id)
      .input('date', sql.Date, appointment_date)
      .input('time', sql.VarChar, appointment_time)
      .query(`
        UPDATE Doctors_booking
        SET appointment_date = @date,
            appointment_time = @time
        WHERE id = @id
      `);

    if (result.rowsAffected[0] === 0) {
      return res.status(404).json({ error: "Booking not found" });
    }

    res.status(200).json({ message: "Booking updated successfully" });
  } catch (error) {
    console.error("Update error:", error);
    res.status(500).json({ error: "Failed to update booking" });
  }
});

export default router;