const fs = require('fs');
const p = 'app/staff/(protected)/imports/[id]/map/_components/EditDemoSessionModal.tsx';
const src = fs.readFileSync('scripts/write-modal.txt', 'utf8');
fs.writeFileSync(p, src, 'utf8');
console.log('done, lines:', src.split('\n').length);
