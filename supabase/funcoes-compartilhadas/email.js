// E-mails com a marca Gestão sem Caos (mesmo visual de supabase/templates/*.html: logo PNG, faixa laranja,
// botão em pílula). Só texto e link: nunca anexos. Tudo que vem de fora passa por escaparHtml().

export const LOGO_EMAIL = 'https://disc.gestaosemcaos.com.br/assets/marca/gsc-logo-email.png';

export function escaparHtml(s) {
  return String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

const P = 'margin:0 0 16px;font-size:16px;line-height:1.6;color:#13283F';

/**
 * HTML do e-mail na moldura da marca.
 * m = { titulo, previa?, paragrafos: [texto], botao: {texto, url}, nota?, rodape? }
 */
export function htmlMarca(m) {
  const paras = (m.paragrafos || []).filter((t) => t !== null && t !== undefined && String(t) !== '')
    .map((t) => '<p style="' + P + '">' + escaparHtml(t).replace(/\n/g, '<br>') + '</p>').join('');
  const url = escaparHtml(m.botao.url);
  return '<!doctype html><html lang="pt-BR"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">' +
    '<meta name="color-scheme" content="light"><title>' + escaparHtml(m.titulo) + '</title></head>' +
    '<body style="margin:0;padding:0;background:#F4F2EF;font-family:\'Plus Jakarta Sans\',Arial,Helvetica,sans-serif">' +
    (m.previa ? '<span style="display:none;max-height:0;overflow:hidden;opacity:0">' + escaparHtml(m.previa) + '</span>' : '') +
    '<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#F4F2EF;padding:32px 12px"><tr><td align="center">' +
    '<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:560px;background:#FFFFFF;border-radius:16px;overflow:hidden">' +
    '<tr><td style="height:6px;background:#F34405;font-size:0;line-height:0">&nbsp;</td></tr>' +
    '<tr><td style="padding:32px 32px 8px"><img src="' + LOGO_EMAIL + '" width="200" alt="Gestão sem Caos" style="display:block;width:200px;max-width:100%;height:auto;border:0"></td></tr>' +
    '<tr><td style="padding:16px 32px 8px">' +
    '<h1 style="margin:0 0 16px;font-size:24px;line-height:1.25;color:#13283F;font-weight:700">' + escaparHtml(m.titulo) + '</h1>' + paras +
    '<table role="presentation" cellpadding="0" cellspacing="0" style="margin:8px 0 24px"><tr><td style="border-radius:999px;background:#F34405">' +
    '<a href="' + url + '" style="display:inline-block;padding:14px 28px;font-size:16px;font-weight:700;color:#FFFFFF;text-decoration:none;border-radius:999px">' + escaparHtml(m.botao.texto) + '</a>' +
    '</td></tr></table>' +
    (m.nota ? '<p style="margin:0 0 16px;font-size:14px;line-height:1.6;color:#5B6878">' + escaparHtml(m.nota) + '</p>' : '') +
    '<p style="margin:0 0 8px;font-size:13px;line-height:1.6;color:#5B6878">Se o botão não funcionar, copie este endereço no navegador:<br>' +
    '<a href="' + url + '" style="color:#F34405;word-break:break-all">' + url + '</a></p>' +
    '</td></tr>' +
    '<tr><td style="padding:24px 32px 32px;border-top:1px solid #E7E2DC"><p style="margin:0;font-size:12px;line-height:1.6;color:#8A94A2">' +
    escaparHtml(m.rodape || 'Gestão sem Caos · Mapa DISC') + '</p></td></tr>' +
    '</table></td></tr></table></body></html>';
}

export const ASSUNTOS_RELATORIO = {
  pessoa: 'Seu relatório DISC — Gestão sem Caos',
  equipe: 'Relatório de equipe — Gestão sem Caos',
  lideranca: 'Como liderar — relatório da Gestão sem Caos',
  processo: 'Relatório do processo seletivo — Gestão sem Caos'
};

/**
 * E-mail com o link de um relatório publicado (painel -> cliente).
 * d = { modelo, url, nome? (destinatário), mensagem? (do consultor), remetente? (nome do consultor), titulo? (do relatório) }
 * -> { assunto, html, texto }
 */
export function montarEmailRelatorio(d) {
  const modelo = Object.prototype.hasOwnProperty.call(ASSUNTOS_RELATORIO, d.modelo) ? d.modelo : 'processo';
  const primeiro = String(d.nome || '').trim().split(/\s+/)[0] || '';
  const ola = primeiro ? 'Olá, ' + primeiro + '!' : 'Olá!';
  const quem = d.remetente ? d.remetente + ', da Gestão sem Caos,' : 'A Gestão sem Caos';
  const oque = modelo === 'pessoa' ? 'o seu relatório DISC' : (modelo === 'equipe' ? 'o relatório da equipe'
    : (modelo === 'lideranca' ? 'o relatório "Como liderar"' : 'o relatório do processo seletivo'));
  const intro = quem + ' enviou ' + oque + (d.titulo ? ': ' + d.titulo : '') + '.';
  const mensagem = String(d.mensagem || '').trim();
  const nota = 'O link abre o relatório no navegador, no celular ou no computador. Guarde este e-mail para voltar a ele.';
  const html = htmlMarca({
    titulo: modelo === 'pessoa' ? 'Seu relatório DISC está pronto' : 'Relatório pronto para você',
    previa: intro,
    paragrafos: [ola, intro, mensagem],
    botao: { texto: 'Ver relatório', url: d.url },
    nota,
    rodape: 'Gestão sem Caos · Mapa DISC. Você recebeu este e-mail porque a consultoria enviou um relatório para este endereço.'
  });
  const texto = [ola, '', intro].concat(mensagem ? ['', mensagem] : [])
    .concat(['', 'Ver relatório: ' + d.url, '', nota, '', 'Gestão sem Caos']).join('\n');
  return { assunto: ASSUNTOS_RELATORIO[modelo], html, texto };
}
