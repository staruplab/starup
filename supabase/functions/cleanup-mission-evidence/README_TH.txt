ระบบลบรูปหลักฐานภารกิจเก่ากว่า 7 วัน (Supabase Storage)

สิ่งที่ทำ:
- ลบเฉพาะไฟล์ใน bucket mission-evidence
- ลบตาม created_at เมื่ออายุเกิน 7 วัน
- ไม่ลบข้อมูลภารกิจ/คะแนน/การส่งภารกิจในตารางฐานข้อมูล
- ใช้ SUPABASE_SERVICE_ROLE_KEY เฉพาะฝั่ง Edge Function เท่านั้น ห้ามใส่ใน index.html

ติดตั้ง:
1) ติดตั้ง Supabase CLI และล็อกอิน
2) ตั้ง project ref ให้ตรงกับ Supabase ของ STAR UP
3) ตั้ง secret: supabase secrets set SUPABASE_URL=https://YOUR_PROJECT.supabase.co SUPABASE_SERVICE_ROLE_KEY=YOUR_SERVICE_ROLE_KEY
4) Deploy: supabase functions deploy cleanup-mission-evidence --no-verify-jwt
5) ตั้ง Scheduled Edge Function ให้เรียก POST https://YOUR_PROJECT.supabase.co/functions/v1/cleanup-mission-evidence ทุกวัน เวลา 03:00 (Asia/Bangkok)
6) ใส่ Header Authorization: Bearer <SERVICE_ROLE_KEY> ในการเรียกตามระบบตั้งเวลา (เก็บ secret ในระบบหลังบ้านเท่านั้น)

ทดสอบด้วย POST และ Authorization header เดียวกัน ผลลัพธ์ควรเป็น JSON { ok: true, retention_days: 7, deleted_objects: N }

ข้อควรทราบ: โค้ดนี้เป็น backend source ที่เตรียมให้แล้ว แต่จะเริ่มลบอัตโนมัติหลัง deploy function และตั้ง schedule ใน Supabase สำเร็จเท่านั้น
