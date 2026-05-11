#!/bin/bash

curl -s -X POST http://localhost:3000/api/staff-auth/request-code \
  -H "Content-Type: application/json" \
  -d '{}'