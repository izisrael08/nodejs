const puppeteer = require('puppeteer');
const mysql = require('mysql2/promise');
const express = require('express');
const path = require('path');
const cors = require('cors');
require('dotenv').config();

const app = express();

// Configuração de CORS
const corsOptions = {
  origin: process.env.FRONTEND_URL || '*',
  methods: ['GET', 'POST', 'PUT', 'DELETE'],
  allowedHeaders: ['Content-Type', 'Authorization']
};

app.use(cors(corsOptions)); // Habilita CORS para todas as rotas

// Conexão com o banco de dados usando as variáveis de ambiente
const pool = mysql.createPool({
  host: process.env.DB_HOST,  // Usando a variável de ambiente DB_HOST
  user: process.env.DB_USER,  // Usando a variável de ambiente DB_USER
  password: process.env.DB_PASSWORD,  // Usando a variável de ambiente DB_PASSWORD
  database: process.env.DB_NAME,  // Usando a variável de ambiente DB_NAME
  connectionLimit: 10,  // Número máximo de conexões simultâneas
  connectTimeout: 30000, // Aumente o timeout para 30 segundos
});

// console.log(process.env.DB_HOST); // Verifique se está carregando corretamente

if (!process.env.DB_HOST) {
  console.error("Erro: DB_HOST não está definido.");
  process.exit(1);  // Encerra a aplicação com código de erro
}

// Flags para evitar múltiplas execuções simultâneas
let isScraping = false;
let isLogging = false;

// Função para salvar resultados no banco de dados
async function saveResultsToDatabase(results) {
  const connection = await pool.getConnection();
  try {
    for (const card of results) {
      for (const result of card.results) {
        const [rows] = await connection.execute(`
          SELECT COUNT(1) AS Count
          FROM ResultadosLoteria
          WHERE Titulo = ? AND Hora = ? AND Premio = ?`, [card.title, card.time, result.prize]);

        if (rows[0].Count === 0) {
          await connection.execute(`
            INSERT INTO ResultadosLoteria (Titulo, Hora, Premio, Resultado, Grupo)
            VALUES (?, ?, ?, ?, ?)`, [card.title, card.time, result.prize, result.result, result.group]);
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
      args: ['--no-sandbox', '--disable-setuid-sandbox']
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
      currentDate.setDate(currentDate.getDate() - 1);
    }

    if (results && results.length > 0) {
      console.log("Dados coletados:", JSON.stringify(results, null, 2));
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

// Função para rodar o scraper periodicamente a cada 1 minuto
async function runScraperPeriodically() {
  if (isScraping) {
    console.log("O processo de scraping já está em andamento. Aguardando...");
    return; // Não inicia o scraper se já estiver em andamento
  }

  if (isLogging) {
    return; // Se já iniciou o log, não faz o log novamente
  }

  console.log("Iniciando o processo de scraping periódico...");
  isLogging = true; // Marcar que o log foi exibido

  isScraping = true; // Marca como scraping em andamento
  try {
    await scrapeWebsite(); // Executa o scraping
  } catch (error) {
    console.error("Erro no processo de scraping:", error);
  } finally {
    isScraping = false; // Marca como terminado, permitindo nova execução
    isLogging = false; // Reseta o flag do log
  }
}

// Rota para a raiz '/'
app.get('/', (req, res) => {
  res.send('Servidor funcionando corretamente!');
});

// Função para iniciar o servidor
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Servidor rodando na porta ${PORT}`);
});

// Configuração para rodar o scraper periodicamente (a cada 1 minuto)
setInterval(runScraperPeriodically, 1 * 60 * 1000); // Roda a cada 1 minuto
