require('dotenv').config(); // Para carregar as variáveis do .env
const express = require('express');
const puppeteer = require('puppeteer');
const mysql = require('mysql2/promise');

// Criando a instância do Express
const app = express();

// Conexão com o banco de dados
const pool = mysql.createPool({
    uri: process.env.DATABASE_URL
});

// Função para salvar resultados no banco de dados
async function saveResultsToDatabase(results) {
    const connection = await pool.getConnection();
    try {
        for (const card of results) {
            for (const result of card.results) {
                await connection.execute(`
                    INSERT INTO ResultadosLoteria (Titulo, Hora, Premio, Resultado, Grupo)
                    VALUES (?, ?, ?, ?, ?)`, 
                    [card.title, card.time, result.prize, result.result, result.group]);
            }
        }
        console.log("Dados inseridos com sucesso no banco de dados!");
    } catch (error) {
        console.error("Erro ao salvar os resultados no banco:", error);
    } finally {
        connection.release();
    }
}

// Função para buscar os resultados via scraping
async function searchResults(page, date) {
    console.log(`Buscando resultados para a data: ${date}`);
    await page.evaluate((date) => {
        const dateInput = document.querySelector('.resultados__container-input--date input[type="date"]');
        if (dateInput) {
            dateInput.value = date;
            dateInput.dispatchEvent(new Event('change', { bubbles: true }));
        }
    }, date);

    try {
        await page.waitForSelector(".results__card", { timeout: 10000 });
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
        browser = await puppeteer.launch({ headless: true });
        const page = await browser.newPage();
        await page.goto("https://loteriasbr.com/", { waitUntil: "networkidle2" });

        let currentDate = new Date();
        let results = null;

        for (let i = 0; i < 7; i++) {
            const formattedDate = currentDate.toISOString().split("T")[0];
            results = await searchResults(page, formattedDate);
            if (results && results.length > 0) {
                break;
            }
            currentDate.setDate(currentDate.getDate() - 1);
        }

        if (results && results.length > 0) {
            console.log("Dados coletados:", results);
            await saveResultsToDatabase(results);
            return results;
        } else {
            console.log("Nenhum resultado encontrado nos últimos 7 dias.");
            return [];
        }
    } catch (error) {
        console.error("Erro ao fazer scraping:", error);
        return [];
    } finally {
        if (browser) {
            await browser.close();
        }
    }
}

// Rota para realizar o scraping e retornar os dados coletados
app.get('/scrape', async (req, res) => {
    try {
        const results = await scrapeWebsite();
        res.json({ success: true, data: results });
    } catch (error) {
        res.status(500).json({ success: false, message: "Erro ao realizar o scraping", error: error.message });
    }
});

// Iniciar o servidor
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
    console.log(`Servidor rodando na porta ${PORT}`);
});
