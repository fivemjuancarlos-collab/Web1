require('dotenv').config();
const app = require('./server');

const PORT = process.env.PORT || 3000;

const server = app.listen(PORT, () => {
    console.log('\n' + '='.repeat(50));
    console.log('✅ Sistema de Verificación Discord ENCENDIDO');
    console.log(`🌐 URL: http://localhost:${PORT}`);
    console.log('🤖 Bot API: Configurado correctamente');
    console.log('='.repeat(50) + '\n');
});

server.on('error', (err) => {
    console.error('🔥 Error del servidor:', err);
});

process.on('SIGINT', () => {
    console.log('\n🛑 Servidor apagándose...');
    server.close(() => {
        process.exit(0);
    });
});
