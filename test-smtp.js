const nodemailer = require('nodemailer');

// Replace with your actual app password (no spaces)
const APP_PASSWORD = 'YOUR_16_CHAR_PASSWORD_HERE';

const transporter = nodemailer.createTransport({
  host: 'smtp.gmail.com',
  port: 587,
  secure: false, // true for 465, false for 587
  auth: {
    user: 'ticketlessamerica@gmail.com',
    pass: APP_PASSWORD
  }
});

transporter.verify(function(error, success) {
  if (error) {
    console.log('Authentication failed:', error);
  } else {
    console.log('SMTP connection is ready!');
  }
});