#!/usr/bin/env python3
import smtplib

# Replace with your actual 16-character app password (no spaces)
APP_PASSWORD = input("Paste your 16-character app password here (no spaces): ")

print("\nTrying Port 587 with TLS...")
try:
    server = smtplib.SMTP('smtp.gmail.com', 587)
    server.starttls()
    server.login('ticketlessamerica@gmail.com', APP_PASSWORD)
    print("✅ SUCCESS with Port 587/TLS! Use these settings in Gmail.")
    server.quit()
except Exception as e:
    print(f"❌ Failed with 587/TLS: {e}")

print("\nTrying Port 465 with SSL...")
try:
    server = smtplib.SMTP_SSL('smtp.gmail.com', 465)
    server.login('ticketlessamerica@gmail.com', APP_PASSWORD)
    print("✅ SUCCESS with Port 465/SSL! Use these settings in Gmail.")
    server.quit()
except Exception as e:
    print(f"❌ Failed with 465/SSL: {e}")