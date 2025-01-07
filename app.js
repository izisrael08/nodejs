const puppeteer = require('puppeteer');
const mysql = require('mysql2/promise');
const express = require('express');
const path = require('path');
const cors = require('cors');
require('dotenv').config();

const app = express();

// Configuração de CORS
const corsOptions = {
  origin: process.env.FRONTEND_URL || '*', // Permite qualquer origem, ou especifica a URL do front-end se definida nas variáveis de ambiente
  methods: ['GET', 'POST', 'PUT', 'DELETE'],
  allowedHeaders: ['Content-Type', 'Authorization']
};

app.use(cors(corsOptions)); // Habilita CORS para todas as rotas

// Conexão com o banco de dados usando as variáveis de ambiente
const pool = mysql.createPool({
  host: process.env.DB_HOST,
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
  database: process.env.DB_NAME,
  port: process.env.DB_PORT || 3306 // Adicionando porta do DB como 3306 por padrão
});

// Middleware para servir arquivos estáticos (como index.html) da pasta public
app.use(express.static(path.join(__dirname, 'public')));

// Função para salvar resultados no banco de dados
async function saveResultsToDatabase(results) {
  const connection = await pool.getConnection(); // Pega uma conexão do pool
  try {
    for (const card of results) {
      for (const result of card.results) {
        const [rows] = await connection.execute(`
          SELECT COUNT(1) AS Count
          FROM ResultadosLoteria
          WHERE Titulo = ? AND Hora = ? AND Premio = ?
        `, [card.title, card.time, result.prize]);

        if (rows[0].Count === 0) {
          await connection.execute(`
            INSERT INTO ResultadosLoteria (Titulo, Hora, Premio, Resultado, Grupo)
            VALUES (?, ?, ?, ?, ?)
          `, [card.title, card.time, result.prize, result.result, result.group]);
        } else {
          console.log(`Registro duplicado encontrado: ${card.title}, ${card.time}, ${result.prize}`);
        }
      }
    }
    console.log("Dados inseridos com sucesso!");
  } catch (error) {
    console.error("Erro ao salvar os resultados no banco:", error);
  } finally {
    connection.release(); // Libera a conexão de volta para o pool
  }
}

// Função para ajustar a data no campo e buscar resultados
async function searchResults(page, date) {
  console.log(`Buscando resultados para a data: ${date}`);

  // Define a data no campo de entrada
  await page.evaluate((date) => {
    const dateInput = document.querySelector('.resultados__container-input--date input[type="date"]');
    if (dateInput) {
      dateInput.value = date;
      dateInput.dispatchEvent(new Event('change', { bubbles: true }));
    }
  }, date);

  // Aguarda os resultados após alterar a data
  try {
    await page.waitForSelector(".results__card", { timeout: 10000 });
    console.log("Resultados encontrados!");
    return await page.evaluate(() => {
      const cards = Array.from(document.querySelectorAll(".results__card"));
      return cards.map(card => {
        const titleElement = card.querySelector(".results__card--title span");
        const timeElement = card.querySelector(".results__card--header > span");
        const tableRows = card.querySelectorAll("tbody tr");

        const title = titleElement ? titleElement.innerText : "Título não encontrado";
        const time = timeElement ? timeElement.innerText : "Hora não encontrada";

        const resultData = Array.from(tableRows).map(row => {
          const prizeElement = row.querySelector("td");
          const groupElement = row.querySelector(".results__table-grupo span");
          const resultElements = row.querySelector(".results__table-align-results");

          const prize = prizeElement ? prizeElement.innerText : "Prêmio não encontrado";
          const result = resultElements ? resultElements.innerText.trim().split(" ").join(" ") : "(sem dados)";
          const group = groupElement ? groupElement.innerText : "Grupo não encontrado";

          return { prize, result, group };
        }).filter(data => data.prize);

        return { title, time, results: resultData };
      });
    });
  } catch (error) {
    console.log("Nenhum resultado encontrado para esta data.");
    return null;
  }
}

// Função para realizar o scraping
async function scrapeWebsite() {
  let browser;
  try {
    browser = await puppeteer.launch({
      headless: true,
      args: ['--no-sandbox', '--disable-setuid-sandbox'] // Adiciona a flag --no-sandbox
    });
    const page = await browser.newPage();
    await page.goto("https://loteriasbr.com/", { waitUntil: "networkidle2" });

    let currentDate = new Date();
    let results = null;

    // Tenta buscar resultados até encontrar ou alcançar uma data limite (ex.: 7 dias atrás)
    for (let i = 0; i < 7; i++) {
      const formattedDate = currentDate.toISOString().split("T")[0]; // Formata para 'YYYY-MM-DD'
      results = await searchResults(page, formattedDate);
      if (results && results.length > 0) {
        break; // Sai do loop se encontrar resultados
      }
      // Ajusta para o dia anterior
      currentDate.setDate(currentDate.getDate() - 1);
    }

    if (results && results.length > 0) {
      // Dentro do seu código onde você coleta os resultados:

      console.log("Dados coletados:", JSON.stringify(results, null, 2)); // Adiciona a formatação para exibição dos dados

      await saveResultsToDatabase(results);
    } else {
      console.log("Nenhum resultado encontrado nos últimos 7 dias.");
    }
  } catch (error) {
    console.error("Erro ao fazer scraping:", error);
  } finally {
    if (browser) {
      await browser.close();
    }
  }
}

// Função para rodar o scraper periodicamente a cada 2 minutos
async function runScraperPeriodically() {
  console.log("Iniciando o processo de scraping periódico...");
  await scrapeWebsite(); // Busca novos dados periodicamente
}

// Rota para a raiz '/'
app.get('/', (req, res) => {
  res.send('Servidor funcionando corretamente!');
});

// Rota para exibir os resultados
app.get('/results', async (req, res) => {
  const connection = await pool.getConnection();

  try {
    const [rows] = await connection.execute(`
      SELECT Titulo, Hora, Premio, Resultado, Grupo, DATE_FORMAT(DataInsercao, '%d/%m/%Y') AS DataInsercao
      FROM ResultadosLoteria
      ORDER BY Hora DESC, DataInsercao DESC
    `);

    const groupedResults = rows.reduce((acc, current) => {
      const key = `${current.Titulo}-${current.Hora}`;
      if (!acc[key]) {
        acc[key] = { Titulo: current.Titulo, Hora: current.Hora, Dia: current.DataInsercao, Resultados: [] };
      }
      acc[key].Resultados.push({ Premio: current.Premio, Resultado: current.Resultado, Grupo: current.Grupo });
      return acc;
    }, {});

    res.json(Object.values(groupedResults));
  } catch (error) {
    res.status(500).json({ message: 'Erro ao recuperar os resultados', error: error.message });
  } finally {
    connection.release();
  }
});

// Função para iniciar o servidor
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Servidor rodando na porta ${PORT}`);
});

// Configuração para rodar o scraper periodicamente (a cada 2 minutos)
setInterval(async () => {
  console.log("Iniciando o processo de scraping periódico...");
  await runScraperPeriodically();
}, 1 * 60 * 1000); // Roda a cada 1 minuto
