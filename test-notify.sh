#!/bin/bash
curl -X POST http://localhost:3001/api/test-force-notification -H "Content-Type: application/json" -d '{"email":"randyvollrath@gmail.com","phone":"+12243217290","testType":"all"}'