import sql from 'mssql';

const dbConfig = {
    user: "sa",              // اسم المستخدم في SQL Server
    password:"1234567899876543210",      // كلمة المرور
    server:"MINAMAHER/SQLEXPRESS01" ,            // اسم السيرفر (مثال: "MINAMAHER\SQLEXPRESS01" أو "127.0.0.1")
    database: "vaccination_db",      // اسم قاعدة البيانات
    options: {
        encrypt: true,                     // تعطيل التشفير إذا كنت تستخدم الاتصال المحلي
        trustServerCertificate: true        // حل مشاكل SSL المحلية
    }
};

// الاتصال بقاعدة البيانات
async function connectDB() {
    try {
        await sql.connect(dbConfig);
        console.log("✅ Connected to SQL Server");
    } catch (err) {
        console.error("❌ Database connection failed", err);
    }
}
connectDB();
