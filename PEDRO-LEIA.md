# Pedro: atualizações do site-lucas

Este zip tem os arquivos nos **mesmos caminhos do repositório**. Copie tudo para a raiz do `site-lucas`,
substituindo os arquivos existentes, e **rode `git diff` antes do commit**. As mudanças foram feitas sobre os
arquivos que o Lucas tinha em 18/10. Se o repositório tiver algo mais novo, o diff mostra o que seria sobrescrito.
(`.github/` e `.vercelignore` começam com ponto e podem ficar ocultos no Finder/Explorer.)

## O que mudou

| Arquivo | Mudança |
|---|---|
| `research.html` | Grupo ACG 2026 (7 abstracts) em Presentations; botão de filtro "Preprints"; contador "· 1 preprint" |
| `pubs.js` | Preprint novo (`n:"P1"`, `st:"pre"`), da Research Square, no fim do arquivo |
| `assets/site.js` | Suporte a `st:"pre"`: selo "Preprint", numeração P1, P2…, filtro, contador. Preprints não entram em "published" |
| `papers/MarinLopez2026_ResearchSquare_CDI_GI_cancer.pdf` | PDF do preprint (licença CC BY 4.0, pode ser hospedado) |
| `api/scholar.js` | Citações do Google Scholar via SerpApi. Não muda se já estiver no repositório |
| `.github/workflows/pubmed-sync.yml` | **Novo.** Action semanal do PubMed (segundas, 09:17 UTC) + botão "Run workflow" |
| `scripts/pubmed-sync.mjs` | **Novo.** Consulta o PubMed (E-utilities) e atualiza o `pubs.js`. Node 22, sem dependências |
| `scripts/pubmed.config.json` | **Novo.** O termo de busca (o mesmo do link do PubMed na página Research) |
| `scripts/pubmed-seen.json` | **Novo.** PMIDs já revisados, para nenhum artigo ser sugerido duas vezes |
| `.vercelignore` | **Novo.** Impede que `scripts/` e `.github/` sejam publicados. Se já existir um, junte as linhas |

## 1. PubMed automático

Toda segunda-feira a Action roda a busca do Lucas no PubMed. Se aparecer artigo que ainda não está no `pubs.js`,
ela abre um pull request atribuído ao dono do repositório, e o GitHub manda e-mail. Dar merge publica o artigo
(o Vercel faz o redeploy). Nada vai ao ar sem aprovação.

1. Depois do push: Settings → Actions → General → "Workflow permissions" → marcar
   **"Allow GitHub Actions to create and approve pull requests"** → Save.
2. Testar: Actions → "PubMed sync" → **Run workflow**. Leva menos de 1 minuto.
   - "No new PubMed records." → funcionou, não há nada novo.
   - Um PR "New PubMed publications" aberto → funcionou.

## 2. Google Scholar (citações, h-index, i10 e o gráfico por ano)

O código já estava pronto, mas nunca foi ativado. O Google Scholar não tem API, então o SerpApi lê o perfil
(`StCPz7sAAAAJ`) pelo servidor do Vercel. A chave fica só no Vercel, e a resposta fica em cache por 24 h, então são
poucas chamadas por mês, bem dentro do plano grátis. Se a API falhar, o site mostra os números escritos no HTML.

1. Criar uma conta grátis em https://serpapi.com e copiar a "Private API Key" (em Dashboard).
2. Vercel → projeto do site → Settings → Environment Variables → nome `SERPAPI_KEY`, valor = a chave,
   marcar Production (e Preview) → Save → Deployments → último deploy → **Redeploy**.
3. Testar: abrir `https://<domínio-do-site>/api/scholar`.
   - Tem que aparecer algo como `{"cites_all":255,"h_all":9,...}`.
   - `SERPAPI_KEY is not set` → a variável não foi salva, ou o redeploy não foi feito.
   - `404` → o `api/scholar.js` não está no repositório.

## Detalhes do PubMed

- **E-mail de confirmação:** o PR é atribuído a `github.repository_owner` (DelgadoPedro). Para o Lucas também
  receber, adicione `lucasmonteirodelgado` como colaborador e assine o repositório (Watch → All Activity).
- **Revisar um PR:** dar merge publica tudo. Para recusar só um artigo, apague a linha dele no `pubs.js` dentro do
  PR antes do merge (ele não volta a ser sugerido). Fechar o PR sem merge recusa todos.
- **Aceitos, preprints e in press:** quando um artigo `st:"acc"`, `st:"pre"` ou sem PMID aparece no PubMed, ele é
  encontrado pelo DOI ou pelo título e atualizado: ganha PMID e citação completa, e sobe para os publicados. Num
  preprint, o DOI e o PDF da Research Square são trocados pelos da revista. Os campos editados à mão (`*` de
  co-primeiro autor, tags, award) são mantidos.
- **Artigos novos:** entram no topo do `pubs.js` com `n` = maior número + 1, `f:1` se o Lucas for o primeiro autor,
  e tags deduzidas pelo título (aparecem no PR para conferir). `oa:1` e `*` não são deduzidos.
- **Opcional:** secret `NCBI_API_KEY` (gerado grátis na conta do NCBI) e `email` em `scripts/pubmed.config.json`.
- **Rodar localmente:** `node scripts/pubmed-sync.mjs` (precisa de acesso à internet).

Testado com respostas de exemplo do PubMed: artigo novo, aceito que foi publicado, preprint que virou artigo,
in press que ganhou PMID, carta e artigo já existente. Rodar duas vezes não duplica nada. A primeira consulta real
ao PubMed vai ser no GitHub.
