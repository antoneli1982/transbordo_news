// Interface de entrada compartilhada pelo PCP e pela TV.
export function solicitarAcesso({ entrar, recuperar }) {
  const dialog = document.createElement('dialog');
  dialog.setAttribute('aria-labelledby', 'tn-login-titulo');
  dialog.innerHTML = `
    <style>
      .tn-login{box-sizing:border-box;width:min(420px,calc(100vw - 32px));margin:auto;padding:clamp(22px,5vw,38px);border:0;border-radius:18px;color:#182746;background:white;font:16px/1.45 system-ui;box-shadow:0 18px 64px #17264136}
      .tn-login::backdrop{background:#162541}
      .tn-login form,.tn-login label{display:grid;gap:6px}.tn-login form{gap:15px}
      .tn-login h1,.tn-login p{margin:0}.tn-login small{color:#425576;font-weight:600}
      .tn-login input,.tn-login button{box-sizing:border-box;font:inherit;min-height:44px;border-radius:8px}
      .tn-login input{width:100%;min-width:0;padding:8px 10px;border:1px solid #8d9bb1}
      .tn-login button{cursor:pointer;color:#174193;background:#edf2fb;border:0;padding:8px 12px}
      .tn-login button[type=submit]{background:#2149b4;color:white;font-weight:650}
      .tn-login [data-senha]{display:flex;gap:6px}.tn-login [hidden]{display:none}
      .tn-login :focus-visible{outline:3px solid #4779ef;outline-offset:2px}
      .tn-login [role=status]{font-size:14px}.tn-login [role=status]:empty{display:none}
    </style>
    <form><small>Transbordo News</small><h1 id="tn-login-titulo">Entrar</h1>
      <label><span data-ident>Login ou e-mail</span><input name="identidade" required autocomplete="username" autocapitalize="none" spellcheck="false"></label>
      <div data-grupo><label for="tn-senha">Senha</label><div data-senha>
        <input id="tn-senha" name="senha" type="password" required autocomplete="current-password">
        <button type="button" data-ver aria-label="Mostrar senha" aria-pressed="false">Mostrar</button>
      </div></div><p role="status" aria-live="polite"></p>
      <button type="submit">Entrar</button><button type="button" data-modo>Esqueci minha senha</button>
    </form>`;
  dialog.className = 'tn-login';
  const form = dialog.querySelector('form');
  const identidade = form.elements.identidade;
  const senha = form.elements.senha;
  const ver = form.querySelector('[data-ver]');
  const modo = form.querySelector('[data-modo]');
  const submit = form.querySelector('[type=submit]');
  const status = form.querySelector('[role=status]');
  let redefinir = false;
  function visibilidade(mostrar) {
    senha.type = mostrar ? 'text' : 'password';
    ver.textContent = mostrar ? 'Ocultar' : 'Mostrar';
    ver.setAttribute('aria-label', ver.textContent + ' senha');
    ver.setAttribute('aria-pressed', String(mostrar));
  }
  ver.onclick = () => visibilidade(senha.type === 'password');
  modo.onclick = () => {
    redefinir = !redefinir;
    senha.value = '';
    visibilidade(false);
    senha.disabled = redefinir;
    form.querySelector('[data-grupo]').hidden = redefinir;
    identidade.type = redefinir ? 'email' : 'text';
    identidade.autocomplete = redefinir ? 'email' : 'username';
    form.querySelector('[data-ident]').textContent = redefinir ? 'E-mail cadastrado' : 'Login ou e-mail';
    form.querySelector('h1').textContent = redefinir ? 'Recuperar senha' : 'Entrar';
    submit.textContent = redefinir ? 'Enviar link de recuperação' : 'Entrar';
    modo.textContent = redefinir ? 'Voltar para o login' : 'Esqueci minha senha';
    status.textContent = '';
    identidade.focus();
  };
  dialog.addEventListener('cancel', event => event.preventDefault());
  document.body.append(dialog);
  dialog.showModal();
  return new Promise(resolve => {
    form.onsubmit = async event => {
      event.preventDefault();
      if (submit.disabled) return;
      submit.disabled = modo.disabled = true;
      status.textContent = 'Aguarde…';
      try {
        if (redefinir) {
          await recuperar(identidade.value.trim());
          status.textContent = 'Se o e-mail estiver cadastrado, você receberá o link para redefinir sua senha.';
        } else {
          const perfil = await entrar(identidade.value.trim(), senha.value);
          senha.value = '';
          dialog.close();
          dialog.remove();
          resolve(perfil);
        }
      } catch (error) {
        status.textContent = error?.code === 'auth/network-request-failed'
          ? 'Falha de conexão. Confira a rede e tente novamente.'
          : redefinir ? 'Não foi possível solicitar o link agora.' : 'Confira seus dados ou consulte o responsável pelo acesso.';
      } finally {
        submit.disabled = modo.disabled = false;
      }
    };
  });
}
