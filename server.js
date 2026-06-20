require('dotenv').config();
const express = require('express');
const session = require('express-session');
const passport = require('passport');
const DiscordStrategy = require('passport-discord').Strategy;
const axios = require('axios');
const cors = require('cors');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 3000;

// Configurar trust proxy para detectar IPs correctamente
app.set('trust proxy', ['loopback', 'linklocal', 'uniquelocal']);
app.use(cors());
app.use(express.static(path.join(__dirname, 'public')));
app.set('view engine', 'ejs');

app.use(session({
    secret: process.env.SESSION_SECRET,
    resave: false,
    saveUninitialized: false,
    cookie: { secure: false, maxAge: 86400000 }
}));

app.use(passport.initialize());
app.use(passport.session());

passport.serializeUser((user, done) => done(null, user));
passport.deserializeUser((user, done) => done(null, user));

passport.use(new DiscordStrategy({
    clientID: process.env.DISCORD_CLIENT_ID,
    clientSecret: process.env.DISCORD_CLIENT_SECRET,
    callbackURL: process.env.REDIRECT_URI,
    scope: ['identify', 'email', 'guilds']
}, (accessToken, refreshToken, profile, done) => {
    console.log('👤 Perfil de Discord recibido:', {
        id: profile.id,
        username: profile.username,
        email: profile.email,
        verified: profile.verified
    });
    return done(null, profile);
}));

// Discord API helper functions
const discordAPI = axios.create({
    baseURL: 'https://discord.com/api/v10',
    headers: {
        'Authorization': `Bot ${process.env.DISCORD_BOT_TOKEN}`,
        'Content-Type': 'application/json'
    }
});

function getClientIP(req) {
    // Lista de headers comunes para IPs reales
    const ipHeaders = [
        'x-forwarded-for',
        'x-real-ip',
        'cf-connecting-ip',
        'x-client-ip',
        'x-cluster-client-ip',
        'forwarded-for',
        'forwarded'
    ];
    
    let ip = null;
    
    // Buscar en los headers primero
    for (const header of ipHeaders) {
        const headerValue = req.headers[header];
        if (headerValue) {
            ip = headerValue;
            break;
        }
    }
    
    // Si no hay headers, usar Express req.ip o métodos alternativos
    if (!ip) {
        ip = req.ip || 
             req.connection?.remoteAddress || 
             req.socket?.remoteAddress ||
             (req.connection?.socket ? req.connection.socket.remoteAddress : null);
    }
    
    // Limpiar la IP
    if (ip) {
        // Si es una lista de IPs, tomar la primera
        if (ip.includes(',')) {
            ip = ip.split(',')[0].trim();
        }
        
        // Si es una IP IPv4 embebida en IPv6, extraer la IPv4
        if (ip.includes('::ffff:')) {
            ip = ip.replace('::ffff:', '');
        }
        
        // Convertir localhost IPv6 a IPv4
        if (ip === '::1' || ip.toLowerCase() === 'localhost') {
            ip = '127.0.0.1';
        }
        
        // Eliminar espacios en blanco
        ip = ip.trim();
    }
    
    return ip || '127.0.0.1';
}

async function checkVPN(ip) {
    try {
        console.log('🌐 Verificando VPN y obteniendo ubicación para IP:', ip);
        const response = await axios.get(`https://ipapi.co/${ip}/json/`);
        const data = response.data;
        const isVPN = data.vpn || data.proxy || data.tor;
        console.log('🔍 Resultado VPN:', isVPN ? 'SÍ - VPN detectada' : 'NO - Conexión normal');
        return { isVPN, data };
    } catch (error) {
        console.error('❌ Error en check VPN:', error.message);
        return { isVPN: false, data: null };
    }
}

function getAccountAge(userId) {
    const snowflake = BigInt(userId);
    const epoch = 1420070400000n;
    const timestamp = Number((snowflake >> 22n) + epoch);
    const accountDate = new Date(timestamp);
    const now = new Date();
    const diffTime = Math.abs(now - accountDate);
    const diffDays = Math.floor(diffTime / (1000 * 60 * 60 * 24));
    const diffYears = Math.floor(diffDays / 365);
    const diffMonths = Math.floor((diffDays % 365) / 30);
    
    if (diffYears > 0) {
        return `hace ${diffYears} año${diffYears > 1 ? 's' : ''}`;
    } else if (diffMonths > 0) {
        return `hace ${diffMonths} mes${diffMonths > 1 ? 'es' : ''}`;
    } else {
        return `hace ${diffDays} día${diffDays > 1 ? 's' : ''}`;
    }
}

async function addRoleToUser(userId, guildId, roleId) {
    try {
        console.log(`🎯 Asignando rol ${roleId} a usuario ${userId} en servidor ${guildId}`);
        await discordAPI.put(`/guilds/${guildId}/members/${userId}/roles/${roleId}`);
        console.log('✅ Rol asignado correctamente');
        return true;
    } catch (error) {
        console.error('❌ Error al añadir rol:', error.response?.data || error.message);
        return false;
    }
}

async function sendLog(guildId, channelId, embed) {
    try {
        console.log('📝 Enviando log al canal:', channelId);
        console.log('🤖 Token del bot (primeros 10 chars):', process.env.DISCORD_BOT_TOKEN ? process.env.DISCORD_BOT_TOKEN.substring(0, 10) + '...' : 'NO ESTÁ DEFINIDO');
        console.log('📄 Embed a enviar:', JSON.stringify(embed, null, 2));
        
        const response = await discordAPI.post(`/channels/${channelId}/messages`, {
            embeds: [embed]
        });
        
        console.log('✅ Log enviado correctamente! ID del mensaje:', response.data.id);
        return true;
    } catch (error) {
        console.error('❌ Error al enviar log:');
        if (error.response) {
            console.error('  - Estado HTTP:', error.response.status);
            console.error('  - Datos de la respuesta:', JSON.stringify(error.response.data, null, 2));
        } else {
            console.error('  - Mensaje:', error.message);
        }
        return false;
    }
}

async function checkMemberExists(userId, guildId) {
    try {
        console.log(`🔍 Verificando si usuario ${userId} está en servidor ${guildId}`);
        const response = await discordAPI.get(`/guilds/${guildId}/members/${userId}`);
        console.log('✅ Usuario SÍ es miembro del servidor');
        console.log('📋 Roles del usuario:', response.data.roles);
        return true;
    } catch (error) {
        console.error('❌ Error al verificar miembro:', error.response?.data || error.message);
        if (error.response?.status === 404) {
            console.log('❌ Usuario NO encontrado en el servidor');
        }
        return false;
    }
}

async function checkMemberHasRole(userId, guildId, roleId) {
    try {
        console.log(`🔍 Verificando si usuario tiene rol ${roleId}`);
        const response = await discordAPI.get(`/guilds/${guildId}/members/${userId}`);
        const hasRole = response.data.roles.includes(roleId);
        console.log(hasRole ? '✅ Usuario YA tiene el rol' : '🔄 Usuario NO tiene el rol todavía');
        return hasRole;
    } catch (error) {
        console.error('❌ Error al verificar rol:', error.response?.data || error.message);
        return false;
    }
}

app.get('/', (req, res) => {
    res.render('index', { user: req.user });
});

app.get('/auth/discord', passport.authenticate('discord'));

app.get('/auth/discord/callback', 
    passport.authenticate('discord', { failureRedirect: '/' }),
    async (req, res) => {
        try {
            const user = req.user;
            const cleanIP = getClientIP(req);

            console.log('\n' + '='.repeat(50));
            console.log('🔐 NUEVA VERIFICACIÓN INICIADA');
            console.log('📍 IP detectada:', cleanIP);
            console.log('='.repeat(50));

            if (!user.verified) {
                console.log('❌ ERROR: Correo de Discord NO verificado');
                return res.render('error', { message: 'Tu correo de Discord no está verificado. Por favor, verifica tu correo antes de continuar.' });
            }

            const { isVPN, data: ipData } = await checkVPN(cleanIP);
            if (isVPN) {
                console.log('❌ ERROR: VPN detectada');
                return res.render('error', { message: 'Se ha detectado el uso de VPN/Proxy. Por favor, desactívalo y vuelve a intentarlo.' });
            }

            const guildId = process.env.DISCORD_GUILD_ID;
            const roleId = process.env.DISCORD_VERIFIED_ROLE_ID;
            const logChannelId = process.env.DISCORD_LOG_CHANNEL_ID;

            const memberExists = await checkMemberExists(user.id, guildId);
            if (!memberExists) {
                console.log('❌ ERROR: Usuario no es miembro del servidor');
                return res.render('error', { message: 'No eres miembro del servidor. Únete primero antes de verificar.' });
            }

            const alreadyVerified = await checkMemberHasRole(user.id, guildId, roleId);
            if (alreadyVerified) {
                console.log('✅ Usuario ya está verificado');
                return res.render('success', { message: 'Ya estás verificado!' });
            }

            const roleAdded = await addRoleToUser(user.id, guildId, roleId);
            if (!roleAdded) {
                console.log('❌ ERROR: No se pudo asignar el rol');
                return res.render('error', { message: 'No se pudo asignar el rol. Asegúrate de que el bot tenga permisos suficientes.' });
            }

            const accountAge = getAccountAge(user.id);
            const hasNitro = user.premium_type && user.premium_type > 0;
            const badges = user.flags ? getBadges(user.flags) : 'None';

            const embed = {
                color: 0x00ff00,
                title: '✅ VERIFICACION EXITOSA',
                thumbnail: {
                    url: 'https://i.imgur.com/4M34hi2.png'
                },
                fields: [
                    {
                        name: '👤 Usuario',
                        value: `<@${user.id}> (${user.username}#${user.discriminator || '0'})`,
                        inline: false
                    },
                    {
                        name: '🆔 ID',
                        value: user.id,
                        inline: false
                    },
                    {
                        name: '📧 Contacto',
                        value: `Email: ||${user.email || 'No disponible'}||\nVerificado: ${user.verified ? '✅' : '❌'}\nLocale: ${user.locale || 'Desconocido'}\nMFA: 🔒`,
                        inline: false
                    },
                    {
                        name: '💻 Conexión',
                        value: `IP: ||${cleanIP}||\nCuenta creada: ${accountAge}`,
                        inline: false
                    },
                    {
                        name: '🌍 Ubicación',
                        value: `País: ${ipData?.country_code || 'Desconocido'}\nRegión: ${ipData?.region || 'Desconocida'}\nISP: ${ipData?.org || 'Desconocido'}`,
                        inline: false
                    },
                    {
                        name: '🏅 Perfil',
                        value: `Nitro: ${hasNitro ? '✅' : 'Sin Nitro'}\nBadges: ${badges}`,
                        inline: false
                    }
                ],
                timestamp: new Date().toISOString()
            };

            await sendLog(guildId, logChannelId, embed);
            console.log('✅ VERIFICACIÓN COMPLETADA CON ÉXITO!');
            console.log('='.repeat(50) + '\n');
            res.render('success', { message: 'Verificación completada! Has recibido el rol verificado.' });

        } catch (error) {
            console.error('💥 Error general en verificación:', error);
            res.render('error', { message: 'Ocurrió un error durante la verificación. Por favor, inténtalo de nuevo.' });
        }
    }
);

function getBadges(flags) {
    const badgeMap = {
        1: 'Discord Employee',
        2: 'Partnered Server Owner',
        4: 'HypeSquad Events',
        8: 'Bug Hunter Level 1',
        16: 'House Bravery',
        32: 'House Brilliance',
        64: 'House Balance',
        128: 'Early Supporter',
        256: 'Team User',
        1024: 'System',
        4096: 'Bug Hunter Level 2',
        16384: 'Verified Bot',
        32768: 'Early Verified Bot Developer',
        65536: 'Moderator Programs Alumni'
    };

    const badges = [];
    for (const [bit, badge] of Object.entries(badgeMap)) {
        if (flags & bit) {
            badges.push(badge);
        }
    }

    return badges.length > 0 ? badges.join(', ') : 'None';
}

app.get('/logout', (req, res) => {
    req.logout(() => {
        res.redirect('/');
    });
});

const server = app.listen(PORT, () => {
    console.log('\n' + '='.repeat(50));
    console.log('✅ Sistema de Verificación Discord ENCENDIDO');
    console.log(`🌐 URL: http://localhost:${PORT}`);
    console.log('🤖 Bot API: Configurado correctamente');
    console.log('📋 ID del servidor:', process.env.DISCORD_GUILD_ID);
    console.log('🎭 ID del rol verificado:', process.env.DISCORD_VERIFIED_ROLE_ID);
    console.log('📢 ID del canal de logs:', process.env.DISCORD_LOG_CHANNEL_ID);
    console.log('='.repeat(50) + '\n');
});

// Keep the server alive
server.on('error', (err) => {
    console.error('🔥 Error del servidor:', err);
});

process.on('SIGINT', () => {
    console.log('\n🛑 Servidor apagándose...');
    server.close(() => {
        process.exit(0);
    });
});

// Mantener el servidor vivo
setInterval(() => {
    console.log('✅ Servidor está activo...');
}, 5000);
