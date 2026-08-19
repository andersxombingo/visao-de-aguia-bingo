# Visão de Águia – Bingo v0.5

Aplicativo PWA para fotografar cartelas, reconhecer os números e marcar automaticamente as pedras sorteadas.

## Leitura do seu modelo real

A v0.5 foi adaptada para o modelo enviado pelo usuário: **um papel com duas cartelas 5×5**, esquerda e direita, separadas por uma faixa central com logotipo/código.

- Fotografe um papel inteiro por vez.
- Ajuste o retângulo amarelo ao redor do papel completo.
- Duas grades verdes mostram exatamente as regiões que serão lidas.
- O cabeçalho BINGO e a faixa central não entram no OCR.
- O centro de cada grade é livre/coringa.
- O app cria duas cartelas independentes (A e B) e permite corrigir qualquer número antes de salvar.
- A validação usa as faixas oficiais: B 1–15, I 16–30, N 31–45, G 46–60, O 61–75.

Também continua existindo a opção de uma grade 5×5 simples.

## Formas de batida

- **Modo Prime:** horizontal, vertical, 2 diagonais, 4 cantos e 4 formatos de V.
- **Adicional opcional do Prime:** B/I superior, G/O superior, B/I inferior ou G/O inferior, cada um com 4 números formando um quadradinho 2×2.
- **Modo X:** as duas diagonais completas.
- **Cartela cheia:** todos os espaços marcados.

## Instalação

Projeto preparado para GitHub Pages e instalação como PWA no celular.
