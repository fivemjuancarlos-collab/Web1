const express = require('express');
const app = express();
const PORT = 3000;

app.get('/', (req, res) => {
  res.send('¡Servidor funcionando! 🚀');
});

const server = app.listen(PORT, () => {
  console.log(`Servidor corriendo en http://localhost:${PORT}`);
});

// Mantener el servidor vivo
setInterval(() => {
  console.log('Servidor está vivo...');
}, 5000);
