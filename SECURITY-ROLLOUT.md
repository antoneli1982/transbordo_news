# Implantação do controle de acesso do Transbordo News

O site continua no domínio do GitHub Pages configurado em `CNAME`. A versão usa Firebase Authentication e Firestore no projeto `transbordonews`. Os anexos do painel continuam no Firestore. O diretório histórico `functions/` está fora do deploy. Mantenha o plano Spark.

## Antes da troca

1. Combine uma breve pausa nas gravações, confira o estado do PCP nos postos em uso e registre quantos transbordos estão abertos e encerrados. Exporte o catálogo em **Salvar JSON** e a planilha dos colaboradores do posto de referência. Arquive essas cópias em um local privado. O catálogo exportado inclui anexos que podem existir somente naquele navegador.
2. O código anterior está na branch `backup/pre-autenticacao-20261125-e71b309`, commit `e71b30919663a9c44f645f04afc3f559306c6a2a`. No console do Firebase, guarde uma cópia das regras publicadas, confira o UID da conta principal, os provedores, os domínios autorizados, as coleções e a situação do Storage. A coleção `cipa_inscricoes` pertence a outro aplicativo. A política proposta conserva para ela a permissão anteriormente publicada. Qualquer outra coleção que aparecer no inventário precisa ter sua política preservada.
3. Na estação autorizada, com Node 22, execute os comandos abaixo na raiz da branch. O primeiro lê a coleção `paineis` em uma transação consistente, cifra a cópia com uma senha própria e faz uma leitura de conferência. A verificação cobre catálogo, plano e documentos dos anexos referenciados. O arquivo inclui também execuções, travas e outros documentos dessa coleção. Compare o total de execuções com a interface. A lista de Auth, as demais coleções e arquivos de Storage ficam fora dessa cópia.

```sh
node scripts/backup.mjs
node scripts/backup.mjs --conferir CAMINHO_DO_ARQUIVO.tnbackup
```

As senhas são digitadas no terminal com entrada oculta. O diretório de saída é `TransbordoNews-Backups` na pasta do usuário. Guarde a senha do backup separadamente. Para inspecionar uma cópia em uma estação privada, `--extrair arquivo.tnbackup destino-novo.json` grava uma cópia legível em um arquivo novo sem alterar o Firebase.

## Ativação

1. Confira o resultado de **Verificar autenticação do Transbordo** para o commit escolhido. O fluxo usa os emuladores de Auth, Firestore e Storage e o Chromium. No Firebase, habilite **E-mail/senha** para pessoas e **Anônimo** para as TVs. Confira o domínio do site em Authentication. A conta administrativa inicial é associada ao UID já cadastrado pelo administrador. O login é `ivan.antoneli`. A senha e o endereço de e-mail da conta ficam fora do código.
2. Com o backup conferido, aplique as regras do Firestore durante a pausa. A versão anterior perde a permissão de acesso ao painel durante essa janela. A versão autenticada também confere se o Firestore bloqueia a leitura pública antes de abrir a operação.

```sh
firebase deploy --only firestore:rules --project transbordonews
```

3. Confira a situação do Storage no console. Se estiver desativado, mantenha esse estado. Se houver um bucket acessível, inventarie os objetos, permissões IAM, URLs com token e uso por outros aplicativos antes de alterar qualquer regra. A política `storage.rules` fecha o bucket inteiro para os clientes do Firebase. Em um bucket exclusivo já verificado, a publicação seletiva é `firebase deploy --only storage --project transbordonews`. Preserve os objetos. Use o Firestore para os anexos, sem ativar faturamento.
4. Inicialize o perfil da conta principal usando o mesmo fluxo da tela de login e confirme a entrada com o login em caixa alternada. O utilitário exige o backup conferido e verifica a restrição de consulta antes de criar o perfil. Use um checkout privado da branch.

```sh
npm install --no-save --package-lock=false firebase@10.13.0
node scripts/ativar.mjs CAMINHO_DO_ARQUIVO.tnbackup
```

5. Confira a versão candidata na estação com permissão para o domínio e o Firebase. Se houver cadastro de colaboradores no navegador do posto de referência, entre primeiro com um Sênior ou Editor nessa estação. A migração cifra e confere os dados locais e publica a lista no documento privado `paineis/workforce`. Se a base nominal existir somente no código antigo, a opção `--cadastrar-base-original` do utilitário recupera a lista do commit de backup. Ela cria o documento somente se ainda estiver ausente. Compare o número de colaboradores com a planilha exportada. O caminho de recuperação não torna a lista pública no novo site.
6. Valide a entrada do Sênior pelo login e pelo e-mail, a edição com um Editor e a consulta com um Visualizador. Use registros de homologação identificados e confira a auditoria. Abra a URL `?tv=1` na TV, compare o código com o exibido em **Gestão de acessos › TVs** e autorize o aparelho. Confira o plano, a contagem de transbordos, os anexos e a exibição das peças. Depois da conferência, publique pelo mesmo fluxo de Pages e confira o domínio em uma janela nova antes de retomar a operação.

## Postos com dados offline

Cada usuário tem um cofre próprio no IndexedDB. O navegador cifra o conteúdo com AES-GCM. A abertura sem rede usa a última permissão confirmada nesse aparelho e exige a senha. O limite é de oito horas desde a autenticação online. A revogação chega aos aparelhos conectados. Em uma estação isolada, a cópia já autorizada pode ser consultada até o fim desse prazo. O retorno da rede pede nova autenticação para sincronizar alterações feitas offline.

Faça o primeiro acesso com um Editor ou Sênior em cada estação que continha dados da versão antiga, inclusive a que guardava anexos locais. A aplicação confere a cópia cifrada antes de remover o original de cada item. Se um anexo legado estiver indisponível, mantenha os dados do navegador e recupere a origem ou a exportação antes de continuar. A TV usa uma identidade anônima autorizada para exibição e mantém os dados de operação em memória.

## Recuperação

Se a versão candidata falhar, mantenha as regras de acesso protegidas, preserve os registros criados depois do backup e corrija a interface na branch de segurança. Compare por documento qualquer restauração a partir da cópia. O utilitário de backup não escreve no Firestore. A branch da versão anterior preserva o código e os recursos históricos. Ela pode conter a antiga lista de colaboradores no histórico público do Git. Uma mudança de visibilidade ou reescrita desse histórico exige decisão própria do responsável.
