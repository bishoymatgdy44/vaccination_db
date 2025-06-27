import express from "express";
import sql from "mssql";

const app = express();
app.use(express.json()); // لدعم JSON في الطلبات

const config = {
    user: "sa",
    password: "1234567899876543210",
    server: "MINAMAHER\SQLEXPRESS01",
    port: 5001,
    database: "vaccination_db",
    options: {
        encrypt: false, // استخدم true إذا كنت تستخدم SSL
        trustServerCertificate: true,
    }
};

async function connectDB() {
    try {
        let pool = await sql.connect(config);
        console.log("✅ الاتصال بـ SQL Server ناجح!");
        sql.close();
    } catch (err) {
        console.error("❌ خطأ في الاتصال:", err);
    }
}

connectDB(); // الاتصال بقاعدة البيانات

app.post("/register", async (req, res) => {
    console.log("Received data:", req.body);  // تأكيد وصول البيانات
});

