curl -s -c cookies.txt -X POST http://localhost:3000/api/staff-auth/verify-code \
  -H "Content-Type: application/json" \
  -d '{"identifier": "isaac@rivercitycreatives.com", "code": "589360"}'