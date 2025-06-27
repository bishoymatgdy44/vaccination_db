import express from 'express';
import { dbConfig, sql } from '../db.js';
import { DateTime } from 'luxon';

const router = express.Router();


// ✅ عرض جميع الحجوزات مع معالجة الوقت
router.get('/Vaccines_booking', async (req, res) => {
  try {
    const pool = await sql.connect(dbConfig);
    
    // استعلام معدل لضمان إرجاع الوقت بشكل صحيح
    const result = await pool.request().query(`
      SELECT 
        vaccination_id,
        vaccine_id,
        patient_id,
        CONVERT(varchar, appointment_date, 23) as appointment_date,
        CASE 
          WHEN TRY_CAST(appointment_time AS TIME) IS NOT NULL 
          THEN FORMAT(CAST(appointment_time AS TIME), 'hh\\:mm\\:ss')
          ELSE '00:00:00'
        END as appointment_time,
        CONVERT(varchar, birth_date, 23) as birth_date,
        patient_name,
        patient_phone,
        national_id,
        created_at,
        Gender,
        Vaccines_name,
        Service,
        Distance,
        Detail_of_Location
      FROM Vaccines_booking
    `);

    const formattedResults = result.recordset.map(booking => {
      // تنسيق التاريخ
      const appointmentDate = new Date(booking.appointment_date);
      const birthDate = new Date(booking.birth_date);
      const createdAt = new Date(booking.created_at);

      // تنسيق الوقت بشكل آمن
      let formattedTime = 'Invalid Time';
      if (booking.appointment_time && typeof booking.appointment_time === 'string') {
        const timeRegex = /^([01]?\d|2[0-3]):([0-5]?\d):([0-5]?\d)$/;
        if (timeRegex.test(booking.appointment_time)) {
          const [hours, minutes] = booking.appointment_time.split(':');
          const timeDate = new Date();
          timeDate.setHours(hours, minutes, 0);
          formattedTime = timeDate.toLocaleTimeString('en-US', { 
            hour: '2-digit',
            minute: '2-digit',
            hour12: true 
          });
        }
      }

      return {
        ...booking,
        appointment_date: appointmentDate.toISOString().split('T')[0],
        appointment_time: formattedTime,
        birth_date: birthDate.toISOString().split('T')[0],
        created_at: createdAt.toLocaleString('en-US')
      };
    });

    res.status(200).json(formattedResults);
  } catch (error) {
    console.error('Error fetching bookings:', error);
    res.status(500).json({ 
      error: 'Failed to retrieve bookings',
      details: error.message 
    });
  }
});


// ✅ Add new booking
router.post('/Vaccines_booking', async (req, res) => {
  try {
    const {
      appointment_date,
      appointment_time,
      birth_date,
      patient_name,
      patient_phone,
      national_id,
      Gender,
      Vaccines_name,
      Service,
      Distance,
      Detail_of_Location
    } = req.body;

    // ✅ Validate required fields
    if (
      !appointment_date || !appointment_time || !birth_date ||
      !patient_name || !patient_phone || !national_id || !Gender ||
      !Vaccines_name || !Service || !Distance || !Detail_of_Location
    ) {
      return res.status(400).json({ error: 'All fields are required' });
    }

    // ✅ Validate English-only fields
    const englishRegex = /^[A-Za-z0-9\s@.,-]+$/;
    if (
      !englishRegex.test(patient_name) ||
      !englishRegex.test(patient_phone) ||
      !englishRegex.test(national_id) ||
      !englishRegex.test(Gender)
    ) {
      return res.status(400).json({ error: 'All fields must contain only English characters and numbers' });
    }

    // ✅ Validate and format time
    let formattedTime;
    try {
      const timeParts = appointment_time.split(':');
      if (timeParts.length < 2 || timeParts.length > 3) {
        throw new Error('Invalid time format');
      }

      const hours = parseInt(timeParts[0]);
      const minutes = parseInt(timeParts[1]);
      const seconds = timeParts[2] ? parseInt(timeParts[2]) : 0;

      if (hours < 0 || hours > 23 || minutes < 0 || minutes > 59 || seconds < 0 || seconds > 59) {
        throw new Error('Invalid time values');
      }

      formattedTime = `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;
    } catch (error) {
      return res.status(400).json({ 
        error: 'Invalid time format. Please use HH:mm or HH:mm:ss format with valid time values' 
      });
    }

    // ✅ Validate booking datetime
    const now = DateTime.now().setZone('Africa/Cairo');
    const bookingDateTime = DateTime.fromISO(`${appointment_date}T${formattedTime}`, {
      zone: 'Africa/Cairo'
    });

    if (!bookingDateTime.isValid) {
      return res.status(400).json({ error: 'Invalid booking date or time' });
    }

    if (bookingDateTime < now) {
      return res.status(400).json({ error: 'Booking date and time must be in the future' });
    }

    const hh = bookingDateTime.hour;
    const mm = bookingDateTime.minute;
    const totalMinutes = hh * 60 + mm;

    if (totalMinutes < 495 || totalMinutes > 870) { // 8:15 AM to 2:30 PM
      return res.status(400).json({ 
        error: 'Appointments are only available between 8:15 AM and 2:30 PM' 
      });
    }

    // ✅ Check for duplicate booking
    const pool = await sql.connect(dbConfig);
    const duplicate = await pool.request()
      .input('appointment_date', sql.Date, appointment_date)
      .input('appointment_time', sql.VarChar, formattedTime)
      .input('Vaccines_name', sql.NVarChar, Vaccines_name)
      .query(`
        SELECT * FROM Vaccines_booking
        WHERE appointment_date = @appointment_date
        AND appointment_time = @appointment_time
        AND Vaccines_name = @Vaccines_name
      `);

    if (duplicate.recordset.length > 0) {
      return res.status(409).json({ 
        error: 'Duplicate booking for the same vaccine at the same date and time' 
      });
    }

    // ✅ Check available slots
    const maxBookings = (hh === 14 && mm <= 30) ? 5 : 10;
    const bookingsCount = await pool.request()
      .input('appointment_date', sql.Date, appointment_date)
      .input('appointment_hour', sql.Int, hh)
      .query(`
        SELECT COUNT(*) AS booking_count
        FROM Vaccines_booking
        WHERE appointment_date = @appointment_date
        AND DATEPART(HOUR, appointment_time) = @appointment_hour
      `);

    if (bookingsCount.recordset[0].booking_count >= maxBookings) {
      // Try to find next available slot
      let newMinutes = totalMinutes;
      let found = false;
      let suggestedTime = '';

      while (!found && newMinutes <= 870) {
        newMinutes += 15;
        const newHour = Math.floor(newMinutes / 60);
        const newMinute = newMinutes % 60;
        const newTime = `${String(newHour).padStart(2, '0')}:${String(newMinute).padStart(2, '0')}:00`;

        const conflict = await pool.request()
          .input('appointment_date', sql.Date, appointment_date)
          .input('appointment_time', sql.VarChar, newTime)
          .query(`
            SELECT COUNT(*) AS count FROM Vaccines_booking
            WHERE appointment_date = @appointment_date
            AND appointment_time = @appointment_time
          `);

        if (conflict.recordset[0].count < maxBookings) {
          suggestedTime = newTime;
          found = true;
        }
      }

      if (found) {
        return res.status(409).json({
          error: 'No available slots at this time',
          suggested_time: suggestedTime
        });
      } else {
        return res.status(409).json({ 
          error: 'No available slots for the selected date. Please choose another day' 
        });
      }
    }

    // ✅ Create booking
    await pool.request()
      .input('appointment_date', sql.Date, appointment_date)
      .input('appointment_time', sql.VarChar, formattedTime)
      .input('birth_date', sql.Date, birth_date)
      .input('patient_name', sql.NVarChar, patient_name)
      .input('patient_phone', sql.VarChar, patient_phone)
      .input('national_id', sql.VarChar, national_id)
      .input('Gender', sql.VarChar, Gender)
      .input('Vaccines_name', sql.NVarChar, Vaccines_name)
      .input('Service', sql.NVarChar, Service)
      .input('Distance', sql.Float, Distance)
      .input('Detail_of_Location', sql.NVarChar, Detail_of_Location)
      .input('created_at', sql.DateTime, new Date())
      .query(`
        INSERT INTO Vaccines_booking (
          appointment_date, appointment_time, birth_date,
          patient_name, patient_phone, national_id, created_at, Gender,
          Vaccines_name, Service, Distance, Detail_of_Location
        ) VALUES (
          @appointment_date, @appointment_time, @birth_date,
          @patient_name, @patient_phone, @national_id, @created_at, @Gender,
          @Vaccines_name, @Service, @Distance, @Detail_of_Location
        )
      `);

    res.status(201).json({ message: 'Booking created successfully' });

  } catch (error) {
    console.error('Create Booking Error:', error);
    res.status(500).json({ error: 'Internal server error while creating booking' });
  }
});



// ✅ تعديل الحجز باستخدام اسم المريض  
router.patch('/Vaccines_booking/name/:name', async (req, res) => {
  try {
    const { name } = req.params;
    const fields = req.body;

    const pool = await sql.connect(dbConfig);

    // ✅ الحصول على الحجز الحالي حسب اسم المريض
    const bookingResult = await pool.request()
      .input('name', sql.NVarChar, name)
      .query(`SELECT * FROM Vaccines_booking WHERE patient_name = @name`);

    if (bookingResult.recordset.length === 0) {
      return res.status(404).json({ error: 'No booking found for this patient name.' });
    }

    const booking = bookingResult.recordset[0];
    const bookingId = booking.id;

    // ✅ تحقق من التعارض إذا كان التاريخ والوقت واللقاح موجودين
    if (fields.appointment_date && fields.appointment_time && fields.Vaccines_name) {
      const timeObj = new Date(`1970-01-01T${fields.appointment_time}`);

      const duplicate = await pool.request()
        .input('appointment_date', sql.Date, fields.appointment_date)
        .input('appointment_time', sql.Time, timeObj)
        .input('Vaccines_name', sql.NVarChar, fields.Vaccines_name)
        .input('id', sql.Int, bookingId)
        .query(`SELECT * FROM Vaccines_booking
                WHERE appointment_date = @appointment_date
                AND appointment_time = @appointment_time
                AND Vaccines_name = @Vaccines_name
                AND id != @id`);

      if (duplicate.recordset.length > 0) {
        return res.status(409).json({ error: 'Duplicate booking for the same vaccine at the same time and date.' });
      }

      fields.appointment_time = timeObj;
    }

    // ✅ بناء الاستعلام الديناميكي للتحديث
    const updates = [];
    const request = pool.request();
    request.input('id', sql.Int, bookingId);

    for (const key in fields) {
      if (fields[key] !== undefined) {
        let value = fields[key];

        switch (key) {
          case 'appointment_date':
          case 'birth_date':
            request.input(key, sql.Date, value);
            break;
          case 'appointment_time':
            request.input(key, sql.Time, value);
            break;
          case 'Distance':
            request.input(key, sql.Float, value);
            break;
          case 'patient_phone':
          case 'national_id':
          case 'Gender':
            request.input(key, sql.VarChar, value);
            break;
          default:
            request.input(key, sql.NVarChar, value);
        }

        updates.push(`${key} = @${key}`);
      }
    }

    if (updates.length === 0) {
      return res.status(400).json({ error: 'No valid fields provided for update.' });
    }

    const query = `UPDATE Vaccines_booking SET ${updates.join(', ')} WHERE id = @id`;

    await request.query(query);

    res.status(200).json({ message: 'Booking updated successfully.' });
  } catch (error) {
    console.error('Patch Booking By Name Error:', error);
    res.status(500).json({ error: 'Error updating booking.' });
  }
});


// ✅ حذف حجز باستخدام اسم المريض
router.delete('/Vaccines_booking/name/:name', async (req, res) => {
  try {
    const { name } = req.params;
    const pool = await sql.connect(dbConfig);

    // أولاً، تأكد من وجود الحجز
    const result = await pool.request()
      .input('name', sql.NVarChar, name)
      .query('SELECT * FROM Vaccines_booking WHERE patient_name = @name');

    if (result.recordset.length === 0) {
      return res.status(404).json({ error: 'No booking found with this patient name.' });
    }

    // حذف كل الحجوزات بنفس الاسم (أو يمكنك تحديد شرط إضافي إذا الاسم مكرر)
    await pool.request()
      .input('name', sql.NVarChar, name)
      .query('DELETE FROM Vaccines_booking WHERE patient_name = @name');

    res.status(200).json({ message: 'Booking(s) deleted successfully.' });
  } catch (error) {
    console.error('Delete Booking By Name Error:', error);
    res.status(500).json({ error: 'Error deleting booking.' });
  }
});


// في ملف routes/booking.js
router.get('/Vaccines_booking/patient/:national_id', async (req, res) => {
  try {
    const { national_id } = req.params;
    const pool = await sql.connect(dbConfig);
    
    const result = await pool.request()
      .input('national_id', sql.VarChar(50), national_id)
      .query(`
        SELECT * FROM Vaccines_booking
        WHERE national_id = @national_id
        ORDER BY created_at DESC
      `);

    res.status(200).json({
      success: true,
      data: result.recordset
    });
  } catch (error) {
    res.status(500).json({ 
      success: false,
      error: error.message 
    });
  }
});


export default router;
