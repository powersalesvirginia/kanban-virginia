# Kanban Virginia (versão de teste)

Sistema de atividades da equipe: login, administradores, times, níveis e áreas, com dados no Firebase (projeto `kanban-virginia`).

- **Site:** publicado pelo GitHub Pages a partir da branch `main` (raiz).
- **Telas:** `index.html` (login e cadastros: contas, times, pessoas, áreas, níveis) e `quadro.html` (atividades: quadro, calendário, indicadores, automações, avisos).
- **Arquivos:** `app.js` + `styles.css` (cadastros), `quadro.js` + `quadro.css` (quadro), `firebase-config.js` (projeto).
- **Anexos:** por enquanto, como links (Drive, OneDrive, SharePoint) dentro do cartão.
- **Regras de segurança:** `firestore.rules`. Não são publicadas pelo GitHub: copie o conteúdo e cole no console do Firebase, em Firestore Database → Regras → Publicar.

A configuração em `firebase-config.js` não é senha: só identifica o projeto. Quem protege os dados são as regras do Firestore.
