# Controle de acesso: implantação em etapas

Esta alteração é uma base de backend, não um login já implantado. Não publicar as regras isoladamente: o painel atual precisa do fluxo autenticado primeiro.

- Ativar o provedor Email/Password no Firebase Authentication e conferir domínio autorizado. Criar o primeiro Sênior pelo administrador do Firebase, com perfil accessUsers/{uid} e alias reservado em accessLogins. Não colocar senha no repositório.
- Integrar tela de login e redefinição de senha por e-mail, usando o SDK de Auth e uma sessão autenticada antes de carregar dados. Implementar autenticação por alias sem expor e-mail ou permitir enumeração de contas; neste estágio o alias só é reservado.
- Integrar tela de usuários às funções administrativas e o histórico de auditoria. O registro do painel contém autor quando disponível e nomes de campos, não um diff detalhado de cada linha.
- Separar a visualização TV e testar como visualizador autenticado.
- Revisar cache legado e IndexedDB, armazenamento de anexos e download URLs com tokens. Migrar anexos para downloads autenticados e revogar tokens legados; não considerar regras de Storage suficientes para URLs existentes. Não persistir dados confidenciais offline sem isolamento/criptografia e política de expiração.
- Testar login, recuperação, troca de perfil, bloqueio imediato no Firestore, usuário desativado, escrita negada ao visualizador mesmo via API, upload/download e operações PCP e TV. Testar falhas parciais das funções, reativação, auditoria e concorrência. Verificar compatibilidade das regras e funções com o ambiente.
- Fazer backup, testar no emulador e ambiente separado; só então coordenar implantação de frontend, funções e regras. A publicação exige acesso administrativo ao Firebase e configuração de faturamento/serviços conforme necessário.
