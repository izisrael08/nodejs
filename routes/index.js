const express = require('express');
const path = require('path');
const puppeteer = require('puppeteer');
const cors = require('cors');
const mysql = require('mysql2/promise');
require('dotenv').config();

// Criando a instância do Express
const app = express();
const router = require('./routes/index'); // Importando o roteador

// Configuração do banco de dados
const pool = mysql.createPool({
  host: process.env.DB_HOST,
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
  database: process.env.DB_NAME,
  port: process.env.PORT,
  connectionLimit: 10,
  connectTimeout: 10000
});

// Middleware para servir arquivos estáticos
app.use(express.static(path.join(__dirname, 'public')));

// Usando as rotas definidas no arquivo router
app.use('/', router);  // Usando o roteador para todas as requisições

// Iniciar o servidor
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Servidor rodando na porta ${PORT}`);
});
