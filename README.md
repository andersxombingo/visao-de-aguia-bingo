# Visão de Águia – Bingo v0.4

Aplicativo web instalável (PWA) para fotografar cartelas individualmente, reconhecer os números e marcar automaticamente as pedras digitadas.

## Formas de batida

- **Modo Prime:** qualquer horizontal, qualquer vertical, as 2 diagonais, 4 cantos ou uma das 4 formas de V.
- **Adicional opcional do Prime:** quadradinhos de 4 números unidos nos cantos. São exatamente quatro possibilidades: B/I superior = B1, I1, B2, I2; G/O superior = G1, O1, G2, O2; B/I inferior = B4, I4, B5, I5; G/O inferior = G4, O4, G5, O5. Basta completar um desses quadradinhos para bater quando o adicional estiver ligado. O adicional vem desligado.
- **Modo X:** as duas diagonais completas ao mesmo tempo.
- **Cartela cheia:** todos os espaços marcados (o centro livre/coringa conta automaticamente quando a cartela usa coringa).

A forma de batida pode ser alterada sem apagar as pedras já digitadas; o app recalcula as cartelas com base no modo atual.

## Publicar grátis no GitHub Pages

1. Crie um repositório **público** no GitHub, por exemplo `visao-de-aguia-bingo`.
2. Envie todos os arquivos desta pasta para a raiz do repositório.
3. No GitHub abra **Settings → Pages**.
4. Em **Build and deployment**, escolha **Deploy from a branch**.
5. Selecione a branch `main`, pasta `/ (root)` e clique em **Save**.
6. Aguarde a URL do GitHub Pages aparecer. Abra essa URL no celular.

O app foi preparado com caminhos relativos, manifest e service worker para funcionar em GitHub Pages.

## Instalar no celular

### Android
Abra a URL no Chrome e use **Instalar app / Adicionar à tela inicial** quando a opção aparecer.

### iPhone
Abra a URL no Safari → Compartilhar → **Adicionar à Tela de Início** → **Abrir como App da Web** → Adicionar.

## Observação sobre o OCR

A leitura automática usa Tesseract.js via CDN. Na primeira leitura da cartela é necessário acesso à internet para carregar o OCR. As cartelas e as pedras são armazenadas no próprio aparelho; depois de reconhecidas, a marcação e a conferência de bingo são locais.
