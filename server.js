import express from 'express'; // استيراد express لإنشاء السيرفر
import dotenv from 'dotenv'; // استيراد dotenv لتحميل المتغيرات من ملف .env
import sql from 'mssql'; // مكتبة التعامل مع SQL Server
import bcrypt from 'bcryptjs'; // مكتبة لتشفير كلمات السر
import jwt from 'jsonwebtoken'; // مكتبة لإنشاء التوكن (JWT)
import cors from 'cors'; // مكتبة لحل مشاكل CORS بين السيرفر والفرونت
import vaccinesRoutes from './routes/vaccines.js';
import doctorsRoutes from './routes/doctors.js';
import doctorsBookingRouter from './routes/doctors_booking.js'; 
import vaccinesBookingRoutes from './routes/Vaccines_booking.js';
import path from 'path';


dotenv.config(); // تحميل المتغيرات من ملف .env

const app = express(); // إنشاء التطبيق باستخدام express
const PORT = process.env.PORT || 5001; // تحديد رقم البورت من المتغيرات أو استخدام البورت الافتراضي 5001
app.use('/uploads',express.static(path.resolve('./uploads')))
app.use(express.json()); // لتحديد أن التطبيق سيقبل البيانات بصيغة JSON في الـ body
app.use(cors()); // لتفعيل CORS (حماية المتصفح)

// إخفاء الهيدر x-powered-by لأسباب أمنية
app.disable('x-powered-by');



const dbConfig = {
    user: process.env.DB_USER, // اسم المستخدم
    password: process.env.DB_PASSWORD, // كلمة المرور
    server: process.env.DB_HOST, // اسم السيرفر أو الـ IP
    database: process.env.DB_DATABASE, // اسم قاعدة البيانات
    options: {
        encrypt: false, // منع التشفير في الاتصال
        trustServerCertificate: true, // لتفادي مشاكل في localhost
    },
};

// اختبار الاتصال بقاعدة البيانات
async function testDBConnection() {
    try {
        await sql.connect(dbConfig); // محاولة الاتصال بقاعدة البيانات
        console.log("✅ Connected to SQL Server database."); // إذا تم الاتصال بنجاح
    } catch (err) {
        console.error("❌ Database connection failed:", err.message); // إذا فشل الاتصال
        process.exit(1); // الخروج من السيرفر إذا فشل الاتصال
    }
}
testDBConnection(); // اختبار الاتصال عند بدء تشغيل السيرفر

// ✅ مسار تسجيل مستخدم جديد
app.post("/api/register", async (req, res) => {
    let { fullName, email, password, rePassword, phone } = req.body;

    // تنظيف المدخلات (إزالة المسافات الزائدة)
    fullName = fullName?.trim();
    email = email?.trim();
    phone = phone?.trim();
    password = password?.trim();
    rePassword = rePassword?.trim();

    // التحقق من وجود الحقول المطلوبة
    if (!fullName || !email || !password || !rePassword) {
        return res.status(400).json({ message: "All fields are required!" });
    }

    // التحقق من تطابق كلمتي السر
    if (password !== rePassword) {
        return res.status(400).json({ message: "Passwords do not match!" });
    }

    try {
        const pool = await sql.connect(dbConfig);

        // التحقق إن المستخدم غير موجود مسبقًا
        const result = await pool.request()
            .input('email', sql.VarChar, email)
            .query('SELECT * FROM dbo.patient WHERE email = @email');

        if (result.recordset.length > 0) {
            return res.status(400).json({ message: "User already exists!" });
        }

        // تشفير كلمة السر
        const hashedPassword = await bcrypt.hash(password, 10);

        // إدخال المستخدم الجديد في الجدول
        await pool.request()
            .input('fullName', sql.VarChar, fullName)
            .input('email', sql.VarChar, email)
            .input('password', sql.VarChar, hashedPassword)
            .input('phone', sql.VarChar, phone || null)
            .query('INSERT INTO dbo.patient (fullName, email, password, phone) VALUES (@fullName, @email, @password, @phone)');

        res.status(201).json({ message: "Registered successfully!" });

    } catch (err) {
        console.error("Registration Error:", err);
        res.status(500).json({ message: "Internal Server Error", error: err.message });
    }
});

// ✅ مسار تسجيل الدخول
app.post("/api/login", async (req, res) => {
    let { email, password } = req.body;
    email = email?.trim();
    password = password?.trim();

    // التحقق من وجود الحقول المطلوبة
    if (!email || !password) {
        return res.status(400).json({ message: "Email and password are required!" });
    }

    try {
        const pool = await sql.connect(dbConfig);

        // جلب المستخدم عن طريق الإيميل
        const result = await pool.request()
            .input('email', sql.VarChar, email)
            .query('SELECT * FROM dbo.patient WHERE email = @email');

        // التحقق من وجود المستخدم
        if (result.recordset.length === 0) {
            return res.status(400).json({ message: "Wrong email or password!" });
        }

        const user = result.recordset[0];

        // التحقق من كلمة السر
        const isMatch = await bcrypt.compare(password, user.password);
        if (!isMatch) {
            return res.status(400).json({ message: "Wrong email or password!" });
        }

        // إنشاء JSON Web Token
        const token = jwt.sign(
            { userId: user.id, email: user.email },
            process.env.JWT_SECRET,
            { expiresIn: '1h' }
        );

        res.status(200).json({ message: "Logged in successfully!", token });

    } catch (err) {
        console.error("Login Error:", err);
        res.status(500).json({ message: "Internal Server Error", error: err.message });
    }
});

// ✅ ميدل وير لحماية المسارات باستخدام التوكن
function authenticateToken(req, res, next) {
    const authHeader = req.headers['authorization'];
    const token = authHeader && authHeader.split(' ')[1];

    if (!token) {
        return res.status(401).json({ message: "Access denied. No token provided." });
    }

    try {
        const user = jwt.verify(token, process.env.JWT_SECRET);
        req.user = user;
        next(); // يستمر في المسار التالي
    } catch (err) {
        return res.status(403).json({ message: "Invalid or expired token." });
    }
}

// ✅ مسار محمي بالتوكن
app.get("/api/protected", authenticateToken, (req, res) => {
    res.status(200).json({ message: `Welcome, User ID: ${req.user.userId}` });
});

// استخدام المسارات المستوردة
app.use('/api/vaccines', vaccinesRoutes);
app.use('/api/doctors', doctorsRoutes);
app.use('/api', doctorsBookingRouter);
app.use('/api', vaccinesBookingRoutes);
app.use('/uploads', express.static('uploads'));







app.listen(PORT,  () => {
    console.log(`🚀 Server is running on port ${PORT}`);
});
