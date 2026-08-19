# Visão de Águia – Bingo v0.6

Versão focada em precisão de leitura no celular.

## Mudança principal

A leitura agora é feita com **uma cartela por foto**. A câmera guiada mostra uma grade 5×5 verde: enquadre somente os 25 quadrados dos números, sem o cabeçalho BINGO e sem a cartela vizinha. Isso evita que o OCR confunda duas cartelas do mesmo papel.

- câmera guiada com recorte automático da grade;
- ajuste fino depois da foto;
- OCR por célula com pré-processamento adaptativo e tentativas alternativas;
- falha em uma célula não derruba a leitura inteira;
- validação automática das faixas B=1–15, I=16–30, N=31–45, G=46–60, O=61–75;
- centro livre;
- Modo Prime, X e Cartela Cheia;
- adicional opcional dos 4 quadradinhos 2×2 dos cantos.

Publicação: GitHub Pages / PWA.
