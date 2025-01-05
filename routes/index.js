const express = require('express');
const router = express.Router();

// Exemplo de função fictícia para scraping (ajuste com sua lógica)
async function scrapeWebsite() {
    return { message: 'Scraping realizado com sucesso!' };
}

// Rota de teste
router.get('/', (req, res) => {
    res.send('Servidor está funcionando!');
});

// Rota para realizar o scraping
router.get('/results', async (req, res) => {
    try {
        const results = await scrapeWebsite(); // Substitua com sua lógica de scraping
        res.json({ success: true, data: results });
    } catch (error) {
        res.status(500).json({ success: false, message: 'Erro ao realizar o scraping', error: error.message });
    }
});

module.exports = router;

