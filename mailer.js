import nodemailer from 'nodemailer';

const transporter = nodemailer.createTransport({
  host: process.env.SMTP_HOST || 'mail.privateemail.com',
  port: Number(process.env.SMTP_PORT || 587),
  secure: String(process.env.SMTP_SECURE || 'false') === 'true',
  auth: {
    user: process.env.SMTP_USER,
    pass: process.env.SMTP_PASS
  }
});

export async function sendWelcomeEmail(toEmail) {
  if (!toEmail) return;
  try {
    await transporter.sendMail({
      from: '"Vault-X Support" <support@vault-x.site>',
      to: toEmail,
      subject: 'Welcome to Vault-X!',
      text: "Thanks for signing up at Vault-X. We're excited to have you with us!"
    });
  } catch (err) {
    console.error('sendWelcomeEmail failed:', err?.message || err);
  }
}


