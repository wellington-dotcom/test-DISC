// ARQUIVO GERADO AUTOMATICAMENTE — NÃO EDITE.
// Cópia de tests/fixtures/processo-exemplo.json (dados fictícios) para a prévia. Para atualizar: npm run montar:fixture
(function (root) {
  var DISC_FIXTURE_PROCESSO = {
    "processo": {
      "id": "proc-exemplo-01",
      "nome": "Escrevente de atendimento",
      "codigo": "EXEMPLO1",
      "empresa": "Cartório Exemplo de Boa Vista",
      "vaga": "Escrevente de atendimento",
      "cidade": "Boa Vista / RR",
      "consultor": "Consultor Exemplo",
      "contratante": "Responsável Exemplo",
      "periodo": {
        "inicio": "2026-08-03",
        "fim": "2026-10-02"
      },
      "clickupListId": "900000000001"
    },
    "config": {
      "perfilIdeal": "CD",
      "explicacaoPerfil": "A rotina do cartório pede conferência rigorosa de documentos com efeito jurídico: o Cauteloso (C) dá o rigor; o Dominante (D) como segundo traço dá firmeza para decidir no balcão.",
      "etapas": [
        {
          "id": "revisao",
          "nome": "Revisão documental",
          "peso": 30,
          "campo": "Nota Revisão documental",
          "descricao": "Documento fictício com cerca de 20 erros em cinco níveis de dificuldade."
        },
        {
          "id": "redacao",
          "nome": "Redação situacional",
          "peso": 15,
          "campo": "Nota Redação situacional",
          "descricao": "Resposta escrita a um conflito no balcão, avaliada em quatro critérios."
        },
        {
          "id": "digitacao",
          "nome": "Digitação",
          "peso": 10,
          "campo": "Nota Digitação",
          "descricao": "Melhor de até três tentativas. Referência: 40 palavras por minuto com 95% de acerto."
        },
        {
          "id": "atencao",
          "nome": "Atenção",
          "peso": 20,
          "campo": "Nota Atenção",
          "descricao": "45 questões cronometradas de identificação de divergências."
        },
        {
          "id": "simulacao",
          "nome": "Simulação ao vivo",
          "peso": 25,
          "campo": "Nota Simulação",
          "descricao": "Três cenários de atendimento encenados na entrevista final."
        }
      ],
      "bonus": [
        {
          "id": "graduacao",
          "nome": "Graduação na área",
          "campo": "Graduação na área",
          "regra": {
            "tipo": "checkbox",
            "pontos": 10
          }
        },
        {
          "id": "presencial",
          "nome": "Perfil presencial",
          "campo": "Perfil presencial",
          "regra": {
            "tipo": "mapa",
            "pontos": {
              "3": 0,
              "4": 10,
              "5": 15
            }
          }
        }
      ],
      "corte": 70,
      "faixaAvaliar": 55,
      "statusFinalistas": [
        "finalista",
        "aprovado"
      ],
      "permitirAntecedentes": false
    },
    "status": [
      {
        "nome": "novo",
        "tipo": "open",
        "cor": "#87909e"
      },
      {
        "nome": "fora do perfil",
        "tipo": "custom",
        "cor": "#b5bcc2"
      },
      {
        "nome": "sem resposta",
        "tipo": "custom",
        "cor": "#f9d900"
      },
      {
        "nome": "aguardando retorno",
        "tipo": "custom",
        "cor": "#ff7800"
      },
      {
        "nome": "finalista",
        "tipo": "custom",
        "cor": "#1090e0"
      },
      {
        "nome": "aprovado",
        "tipo": "custom",
        "cor": "#008844"
      },
      {
        "nome": "desistente",
        "tipo": "closed",
        "cor": "#d33d44"
      }
    ],
    "candidatos": [
      {
        "id": "cu-001",
        "nome": "Ana Exemplo",
        "status": "aprovado",
        "criadoEm": "2026-08-03T12:10:00.000Z",
        "idade": 28,
        "statusTrabalho": "Empregado (CLT)",
        "pretensao": 2600,
        "ultimoSalario": 2500,
        "formacao": "Superior completo",
        "notas": {
          "revisao": 6,
          "redacao": 7.5,
          "digitacao": 6.5,
          "atencao": 8,
          "simulacao": null
        },
        "bonusValores": {
          "graduacao": true,
          "presencial": "5"
        },
        "disc": {
          "percentuais": {
            "D": 17,
            "I": 0,
            "S": 25,
            "C": 58
          },
          "codigo": "CS",
          "confiabilidade": {
            "nivel": "alta",
            "motivos": []
          },
          "protocolo": "4KM"
        },
        "finalista": true
      },
      {
        "id": "cu-002",
        "nome": "Bruna Teste",
        "status": "aprovado",
        "criadoEm": "2026-08-04T13:10:00.000Z",
        "idade": 27,
        "statusTrabalho": "Empregado (CLT)",
        "pretensao": 2800,
        "ultimoSalario": 2700,
        "formacao": "Superior completo",
        "notas": {
          "revisao": 5.5,
          "redacao": 6,
          "digitacao": 10,
          "atencao": 8,
          "simulacao": null
        },
        "bonusValores": {
          "graduacao": true,
          "presencial": "4"
        },
        "disc": {
          "percentuais": {
            "D": 33,
            "I": 0,
            "S": 17,
            "C": 50
          },
          "codigo": "CD",
          "confiabilidade": {
            "nivel": "alta",
            "motivos": []
          },
          "protocolo": "7QP"
        },
        "finalista": true
      },
      {
        "id": "cu-003",
        "nome": "Carla Modelo",
        "status": "finalista",
        "criadoEm": "2026-08-05T14:10:00.000Z",
        "idade": 31,
        "statusTrabalho": "Desempregado",
        "pretensao": 2400,
        "ultimoSalario": 2300,
        "formacao": "Superior incompleto",
        "notas": {
          "revisao": 7,
          "redacao": 3,
          "digitacao": 5,
          "atencao": 8,
          "simulacao": null
        },
        "bonusValores": {
          "graduacao": false,
          "presencial": "4"
        },
        "disc": {
          "percentuais": {
            "D": 25,
            "I": 17,
            "S": 17,
            "C": 41
          },
          "codigo": "CD",
          "confiabilidade": {
            "nivel": "alta",
            "motivos": []
          },
          "protocolo": "9TR"
        },
        "finalista": true
      },
      {
        "id": "cu-004",
        "nome": "Daniela Fictícia",
        "status": "finalista",
        "criadoEm": "2026-08-06T15:10:00.000Z",
        "idade": 24,
        "statusTrabalho": "Empregado (CLT)",
        "pretensao": 2500,
        "ultimoSalario": 2400,
        "formacao": "Ensino médio completo",
        "notas": {
          "revisao": 7,
          "redacao": 5.5,
          "digitacao": 7,
          "atencao": 8,
          "simulacao": null
        },
        "bonusValores": {
          "graduacao": false,
          "presencial": "3"
        },
        "disc": {
          "percentuais": {
            "D": 8,
            "I": 8,
            "S": 33,
            "C": 51
          },
          "codigo": "CS",
          "confiabilidade": {
            "nivel": "media",
            "motivos": [
              "Respondeu rápido demais em parte do teste."
            ]
          },
          "protocolo": "2HX"
        },
        "finalista": true
      },
      {
        "id": "cu-005",
        "nome": "Elisa Amostra",
        "status": "finalista",
        "criadoEm": "2026-08-07T16:10:00.000Z",
        "idade": 35,
        "statusTrabalho": "Autônomo",
        "pretensao": 2700,
        "ultimoSalario": 2900,
        "formacao": "Superior completo",
        "notas": {
          "revisao": 6,
          "redacao": 9,
          "digitacao": 3,
          "atencao": 8,
          "simulacao": null
        },
        "bonusValores": {
          "graduacao": false,
          "presencial": "3"
        },
        "disc": {
          "percentuais": {
            "D": 0,
            "I": 17,
            "S": 8,
            "C": 75
          },
          "codigo": "C",
          "confiabilidade": {
            "nivel": "alta",
            "motivos": []
          },
          "protocolo": "5WB"
        },
        "finalista": true
      },
      {
        "id": "cu-006",
        "nome": "Gabriela Simulada",
        "status": "finalista",
        "criadoEm": "2026-08-08T17:10:00.000Z",
        "idade": 29,
        "statusTrabalho": "Empregado (CLT)",
        "pretensao": 2600,
        "ultimoSalario": 2600,
        "formacao": "Superior incompleto",
        "notas": {
          "revisao": 5.5,
          "redacao": 7,
          "digitacao": 5.5,
          "atencao": 8,
          "simulacao": null
        },
        "bonusValores": {
          "graduacao": false,
          "presencial": "3"
        },
        "disc": {
          "percentuais": {
            "D": 0,
            "I": 33,
            "S": 25,
            "C": 42
          },
          "codigo": "CI",
          "confiabilidade": {
            "nivel": "alta",
            "motivos": []
          },
          "protocolo": "8DN"
        },
        "finalista": true
      },
      {
        "id": "cu-007",
        "nome": "Helena Hipotética",
        "status": "finalista",
        "criadoEm": "2026-08-09T18:10:00.000Z",
        "idade": 26,
        "statusTrabalho": "Desempregado",
        "pretensao": 2300,
        "ultimoSalario": 2200,
        "formacao": "Ensino médio completo",
        "notas": {
          "revisao": 3.5,
          "redacao": 5,
          "digitacao": 6,
          "atencao": 8,
          "simulacao": null
        },
        "bonusValores": {
          "graduacao": false,
          "presencial": "3"
        },
        "disc": {
          "percentuais": {
            "D": 8,
            "I": 0,
            "S": 8,
            "C": 84
          },
          "codigo": "C",
          "confiabilidade": {
            "nivel": "baixa",
            "motivos": [
              "10 de 12 escolhas na mesma letra.",
              "Respostas da confirmação não batem com o resultado."
            ]
          },
          "protocolo": "3FJ"
        },
        "finalista": true
      },
      {
        "id": "cu-008",
        "nome": "Fábio Ensaio",
        "status": "finalista",
        "criadoEm": "2026-08-10T19:10:00.000Z",
        "idade": 33,
        "statusTrabalho": "Empregado (CLT)",
        "pretensao": 2900,
        "ultimoSalario": 2800,
        "formacao": "Superior completo",
        "notas": {
          "revisao": 1.5,
          "redacao": 6,
          "digitacao": 3.5,
          "atencao": 8,
          "simulacao": null
        },
        "bonusValores": {
          "graduacao": true,
          "presencial": "3"
        },
        "disc": {
          "percentuais": {
            "D": 17,
            "I": 42,
            "S": 33,
            "C": 8
          },
          "codigo": "IS",
          "confiabilidade": {
            "nivel": "alta",
            "motivos": []
          },
          "protocolo": "6GZ"
        },
        "finalista": true
      },
      {
        "id": "cu-009",
        "nome": "Igor Rascunho",
        "status": "fora do perfil",
        "criadoEm": "2026-08-11T12:10:00.000Z",
        "idade": 19,
        "statusTrabalho": "Empregado (CLT)",
        "pretensao": 2000,
        "ultimoSalario": 1900,
        "formacao": "Ensino médio completo",
        "notas": {
          "revisao": null,
          "redacao": null,
          "digitacao": null,
          "atencao": null,
          "simulacao": null
        },
        "bonusValores": {
          "graduacao": true,
          "presencial": null
        },
        "disc": null,
        "finalista": false
      },
      {
        "id": "cu-010",
        "nome": "Joana Provisória",
        "status": "fora do perfil",
        "criadoEm": "2026-08-12T13:10:00.000Z",
        "idade": 26,
        "statusTrabalho": "Desempregado",
        "pretensao": 2200,
        "ultimoSalario": 2300,
        "formacao": "Superior incompleto",
        "notas": {
          "revisao": null,
          "redacao": null,
          "digitacao": null,
          "atencao": null,
          "simulacao": null
        },
        "bonusValores": {
          "graduacao": false,
          "presencial": null
        },
        "disc": null,
        "finalista": false
      },
      {
        "id": "cu-011",
        "nome": "Karen Demonstração",
        "status": "fora do perfil",
        "criadoEm": "2026-08-13T14:10:00.000Z",
        "idade": 33,
        "statusTrabalho": "Empregado (CLT)",
        "pretensao": 2400,
        "ultimoSalario": null,
        "formacao": "Superior completo",
        "notas": {
          "revisao": null,
          "redacao": null,
          "digitacao": null,
          "atencao": null,
          "simulacao": null
        },
        "bonusValores": {
          "graduacao": false,
          "presencial": null
        },
        "disc": null,
        "finalista": false
      },
      {
        "id": "cu-012",
        "nome": "Lucas Protótipo",
        "status": "fora do perfil",
        "criadoEm": "2026-08-14T15:10:00.000Z",
        "idade": null,
        "statusTrabalho": "Autônomo",
        "pretensao": 2600,
        "ultimoSalario": 2500,
        "formacao": "Ensino médio completo",
        "notas": {
          "revisao": null,
          "redacao": null,
          "digitacao": null,
          "atencao": null,
          "simulacao": null
        },
        "bonusValores": {
          "graduacao": false,
          "presencial": null
        },
        "disc": null,
        "finalista": false
      },
      {
        "id": "cu-013",
        "nome": "Marina Esboço",
        "status": "fora do perfil",
        "criadoEm": "2026-08-15T16:10:00.000Z",
        "idade": 47,
        "statusTrabalho": "Empregado (CLT)",
        "pretensao": null,
        "ultimoSalario": 2900,
        "formacao": "Técnico",
        "notas": {
          "revisao": null,
          "redacao": null,
          "digitacao": null,
          "atencao": null,
          "simulacao": null
        },
        "bonusValores": {
          "graduacao": true,
          "presencial": null
        },
        "disc": null,
        "finalista": false
      },
      {
        "id": "cu-014",
        "nome": "Nádia Piloto",
        "status": "fora do perfil",
        "criadoEm": "2026-08-16T17:10:00.000Z",
        "idade": 25,
        "statusTrabalho": null,
        "pretensao": 2100,
        "ultimoSalario": 2100,
        "formacao": "Ensino médio completo",
        "notas": {
          "revisao": null,
          "redacao": null,
          "digitacao": null,
          "atencao": null,
          "simulacao": null
        },
        "bonusValores": {
          "graduacao": false,
          "presencial": null
        },
        "disc": null,
        "finalista": false
      },
      {
        "id": "cu-015",
        "nome": "Otávio Amostra",
        "status": "fora do perfil",
        "criadoEm": "2026-08-17T18:10:00.000Z",
        "idade": 32,
        "statusTrabalho": "Estudante",
        "pretensao": 2300,
        "ultimoSalario": 2200,
        "formacao": "Superior incompleto",
        "notas": {
          "revisao": null,
          "redacao": null,
          "digitacao": null,
          "atencao": null,
          "simulacao": null
        },
        "bonusValores": {
          "graduacao": false,
          "presencial": null
        },
        "disc": null,
        "finalista": false
      },
      {
        "id": "cu-016",
        "nome": "Paula Ilustrativa",
        "status": "fora do perfil",
        "criadoEm": "2026-08-18T19:10:00.000Z",
        "idade": 39,
        "statusTrabalho": "Empregado (CLT)",
        "pretensao": 2500,
        "ultimoSalario": null,
        "formacao": "Superior completo",
        "notas": {
          "revisao": null,
          "redacao": null,
          "digitacao": null,
          "atencao": null,
          "simulacao": null
        },
        "bonusValores": {
          "graduacao": false,
          "presencial": null
        },
        "disc": null,
        "finalista": false
      },
      {
        "id": "cu-017",
        "nome": "Renata Teste",
        "status": "fora do perfil",
        "criadoEm": "2026-08-19T12:10:00.000Z",
        "idade": 46,
        "statusTrabalho": "Empregado (CLT)",
        "pretensao": 2700,
        "ultimoSalario": 2700,
        "formacao": "Ensino médio completo",
        "notas": {
          "revisao": null,
          "redacao": null,
          "digitacao": null,
          "atencao": null,
          "simulacao": null
        },
        "bonusValores": {
          "graduacao": true,
          "presencial": null
        },
        "disc": null,
        "finalista": false
      },
      {
        "id": "cu-018",
        "nome": "Sérgio Modelo",
        "status": "fora do perfil",
        "criadoEm": "2026-08-20T13:10:00.000Z",
        "idade": 24,
        "statusTrabalho": "Desempregado",
        "pretensao": 2000,
        "ultimoSalario": 1900,
        "formacao": "Técnico",
        "notas": {
          "revisao": null,
          "redacao": null,
          "digitacao": null,
          "atencao": null,
          "simulacao": null
        },
        "bonusValores": {
          "graduacao": false,
          "presencial": null
        },
        "disc": null,
        "finalista": false
      },
      {
        "id": "cu-019",
        "nome": "Tânia Exemplo",
        "status": "fora do perfil",
        "criadoEm": "2026-08-21T14:10:00.000Z",
        "idade": null,
        "statusTrabalho": "Empregado (CLT)",
        "pretensao": null,
        "ultimoSalario": 2300,
        "formacao": "Ensino médio completo",
        "notas": {
          "revisao": null,
          "redacao": null,
          "digitacao": null,
          "atencao": null,
          "simulacao": null
        },
        "bonusValores": {
          "graduacao": false,
          "presencial": null
        },
        "disc": null,
        "finalista": false
      },
      {
        "id": "cu-020",
        "nome": "Úrsula Fictícia",
        "status": "fora do perfil",
        "criadoEm": "2026-08-22T15:10:00.000Z",
        "idade": 38,
        "statusTrabalho": "Autônomo",
        "pretensao": 2400,
        "ultimoSalario": 2400,
        "formacao": "Superior incompleto",
        "notas": {
          "revisao": null,
          "redacao": null,
          "digitacao": null,
          "atencao": null,
          "simulacao": null
        },
        "bonusValores": {
          "graduacao": false,
          "presencial": null
        },
        "disc": null,
        "finalista": false
      },
      {
        "id": "cu-021",
        "nome": "Vanessa Simulada",
        "status": "fora do perfil",
        "criadoEm": "2026-08-03T16:10:00.000Z",
        "idade": 45,
        "statusTrabalho": "Empregado (CLT)",
        "pretensao": 2600,
        "ultimoSalario": null,
        "formacao": "Superior completo",
        "notas": {
          "revisao": null,
          "redacao": null,
          "digitacao": null,
          "atencao": null,
          "simulacao": null
        },
        "bonusValores": {
          "graduacao": true,
          "presencial": null
        },
        "disc": null,
        "finalista": false
      },
      {
        "id": "cu-022",
        "nome": "Wagner Ensaio",
        "status": "fora do perfil",
        "criadoEm": "2026-08-04T17:10:00.000Z",
        "idade": 23,
        "statusTrabalho": "Desempregado",
        "pretensao": 2800,
        "ultimoSalario": 2900,
        "formacao": "Ensino médio completo",
        "notas": {
          "revisao": null,
          "redacao": null,
          "digitacao": null,
          "atencao": null,
          "simulacao": null
        },
        "bonusValores": {
          "graduacao": false,
          "presencial": null
        },
        "disc": null,
        "finalista": false
      },
      {
        "id": "cu-023",
        "nome": "Yara Hipotética",
        "status": "fora do perfil",
        "criadoEm": "2026-08-05T18:10:00.000Z",
        "idade": 30,
        "statusTrabalho": null,
        "pretensao": 2100,
        "ultimoSalario": 2100,
        "formacao": "Técnico",
        "notas": {
          "revisao": null,
          "redacao": null,
          "digitacao": null,
          "atencao": null,
          "simulacao": null
        },
        "bonusValores": {
          "graduacao": false,
          "presencial": null
        },
        "disc": null,
        "finalista": false
      },
      {
        "id": "cu-024",
        "nome": "Zeca Rascunho",
        "status": "fora do perfil",
        "criadoEm": "2026-08-06T19:10:00.000Z",
        "idade": 37,
        "statusTrabalho": "Empregado (CLT)",
        "pretensao": 2300,
        "ultimoSalario": 2200,
        "formacao": "Ensino médio completo",
        "notas": {
          "revisao": null,
          "redacao": null,
          "digitacao": null,
          "atencao": null,
          "simulacao": null
        },
        "bonusValores": {
          "graduacao": false,
          "presencial": null
        },
        "disc": null,
        "finalista": false
      },
      {
        "id": "cu-025",
        "nome": "Alice Provisória",
        "status": "fora do perfil",
        "criadoEm": "2026-08-07T12:10:00.000Z",
        "idade": 44,
        "statusTrabalho": "Empregado (CLT)",
        "pretensao": null,
        "ultimoSalario": 2600,
        "formacao": "Superior incompleto",
        "notas": {
          "revisao": null,
          "redacao": null,
          "digitacao": null,
          "atencao": null,
          "simulacao": null
        },
        "bonusValores": {
          "graduacao": true,
          "presencial": null
        },
        "disc": null,
        "finalista": false
      },
      {
        "id": "cu-026",
        "nome": "Beatriz Demonstração",
        "status": "fora do perfil",
        "criadoEm": "2026-08-08T13:10:00.000Z",
        "idade": null,
        "statusTrabalho": "Desempregado",
        "pretensao": 2700,
        "ultimoSalario": null,
        "formacao": "Superior completo",
        "notas": {
          "revisao": null,
          "redacao": null,
          "digitacao": null,
          "atencao": null,
          "simulacao": null
        },
        "bonusValores": {
          "graduacao": false,
          "presencial": null
        },
        "disc": null,
        "finalista": false
      },
      {
        "id": "cu-027",
        "nome": "Caio Protótipo",
        "status": "fora do perfil",
        "criadoEm": "2026-08-09T14:10:00.000Z",
        "idade": 29,
        "statusTrabalho": "Empregado (CLT)",
        "pretensao": 2000,
        "ultimoSalario": 1900,
        "formacao": "Ensino médio completo",
        "notas": {
          "revisao": null,
          "redacao": null,
          "digitacao": null,
          "atencao": null,
          "simulacao": null
        },
        "bonusValores": {
          "graduacao": false,
          "presencial": null
        },
        "disc": null,
        "finalista": false
      },
      {
        "id": "cu-028",
        "nome": "Denise Esboço",
        "status": "fora do perfil",
        "criadoEm": "2026-08-10T15:10:00.000Z",
        "idade": 36,
        "statusTrabalho": "Autônomo",
        "pretensao": 2200,
        "ultimoSalario": 2300,
        "formacao": "Técnico",
        "notas": {
          "revisao": null,
          "redacao": null,
          "digitacao": null,
          "atencao": null,
          "simulacao": null
        },
        "bonusValores": {
          "graduacao": false,
          "presencial": null
        },
        "disc": null,
        "finalista": false
      },
      {
        "id": "cu-029",
        "nome": "Eduarda Piloto",
        "status": "fora do perfil",
        "criadoEm": "2026-08-11T16:10:00.000Z",
        "idade": 43,
        "statusTrabalho": "Empregado (CLT)",
        "pretensao": 2400,
        "ultimoSalario": 2400,
        "formacao": "Ensino médio completo",
        "notas": {
          "revisao": null,
          "redacao": null,
          "digitacao": null,
          "atencao": null,
          "simulacao": null
        },
        "bonusValores": {
          "graduacao": true,
          "presencial": null
        },
        "disc": null,
        "finalista": false
      },
      {
        "id": "cu-030",
        "nome": "Fernanda Amostra",
        "status": "sem resposta",
        "criadoEm": "2026-08-12T17:10:00.000Z",
        "idade": 21,
        "statusTrabalho": "Desempregado",
        "pretensao": 2600,
        "ultimoSalario": 2500,
        "formacao": "Superior incompleto",
        "notas": {
          "revisao": null,
          "redacao": null,
          "digitacao": null,
          "atencao": null,
          "simulacao": null
        },
        "bonusValores": {
          "graduacao": false,
          "presencial": null
        },
        "disc": null,
        "finalista": false
      },
      {
        "id": "cu-031",
        "nome": "Giovana Ilustrativa",
        "status": "sem resposta",
        "criadoEm": "2026-08-13T18:10:00.000Z",
        "idade": 28,
        "statusTrabalho": "Estudante",
        "pretensao": null,
        "ultimoSalario": null,
        "formacao": "Superior completo",
        "notas": {
          "revisao": null,
          "redacao": null,
          "digitacao": null,
          "atencao": null,
          "simulacao": null
        },
        "bonusValores": {
          "graduacao": false,
          "presencial": null
        },
        "disc": null,
        "finalista": false
      },
      {
        "id": "cu-032",
        "nome": "Heitor Teste",
        "status": "sem resposta",
        "criadoEm": "2026-08-14T19:10:00.000Z",
        "idade": 35,
        "statusTrabalho": null,
        "pretensao": 2100,
        "ultimoSalario": 2100,
        "formacao": "Ensino médio completo",
        "notas": {
          "revisao": null,
          "redacao": null,
          "digitacao": null,
          "atencao": null,
          "simulacao": null
        },
        "bonusValores": {
          "graduacao": false,
          "presencial": null
        },
        "disc": null,
        "finalista": false
      },
      {
        "id": "cu-033",
        "nome": "Isadora Modelo",
        "status": "sem resposta",
        "criadoEm": "2026-08-15T12:10:00.000Z",
        "idade": null,
        "statusTrabalho": "Empregado (CLT)",
        "pretensao": 2300,
        "ultimoSalario": 2200,
        "formacao": "Técnico",
        "notas": {
          "revisao": null,
          "redacao": null,
          "digitacao": null,
          "atencao": null,
          "simulacao": null
        },
        "bonusValores": {
          "graduacao": true,
          "presencial": null
        },
        "disc": null,
        "finalista": false
      },
      {
        "id": "cu-034",
        "nome": "Júlia Exemplo",
        "status": "sem resposta",
        "criadoEm": "2026-08-16T13:10:00.000Z",
        "idade": 20,
        "statusTrabalho": "Desempregado",
        "pretensao": 2500,
        "ultimoSalario": 2600,
        "formacao": "Ensino médio completo",
        "notas": {
          "revisao": null,
          "redacao": null,
          "digitacao": null,
          "atencao": null,
          "simulacao": null
        },
        "bonusValores": {
          "graduacao": false,
          "presencial": null
        },
        "disc": null,
        "finalista": false
      },
      {
        "id": "cu-035",
        "nome": "Kátia Fictícia",
        "status": "sem resposta",
        "criadoEm": "2026-08-17T14:10:00.000Z",
        "idade": 27,
        "statusTrabalho": "Empregado (CLT)",
        "pretensao": 2700,
        "ultimoSalario": 2700,
        "formacao": "Superior incompleto",
        "notas": {
          "revisao": null,
          "redacao": null,
          "digitacao": null,
          "atencao": null,
          "simulacao": null
        },
        "bonusValores": {
          "graduacao": false,
          "presencial": null
        },
        "disc": null,
        "finalista": false
      },
      {
        "id": "cu-036",
        "nome": "Larissa Simulada",
        "status": "aguardando retorno",
        "criadoEm": "2026-08-18T15:10:00.000Z",
        "idade": 34,
        "statusTrabalho": "Autônomo",
        "pretensao": 2000,
        "ultimoSalario": null,
        "formacao": "Superior completo",
        "notas": {
          "revisao": null,
          "redacao": null,
          "digitacao": null,
          "atencao": null,
          "simulacao": null
        },
        "bonusValores": {
          "graduacao": false,
          "presencial": null
        },
        "disc": null,
        "finalista": false
      },
      {
        "id": "cu-037",
        "nome": "Mateus Ensaio",
        "status": "aguardando retorno",
        "criadoEm": "2026-08-19T16:10:00.000Z",
        "idade": 41,
        "statusTrabalho": "Empregado (CLT)",
        "pretensao": null,
        "ultimoSalario": 2300,
        "formacao": "Ensino médio completo",
        "notas": {
          "revisao": null,
          "redacao": null,
          "digitacao": null,
          "atencao": null,
          "simulacao": null
        },
        "bonusValores": {
          "graduacao": true,
          "presencial": null
        },
        "disc": null,
        "finalista": false
      },
      {
        "id": "cu-038",
        "nome": "Natália Hipotética",
        "status": "aguardando retorno",
        "criadoEm": "2026-08-20T17:10:00.000Z",
        "idade": 19,
        "statusTrabalho": "Desempregado",
        "pretensao": 2400,
        "ultimoSalario": 2400,
        "formacao": "Técnico",
        "notas": {
          "revisao": null,
          "redacao": null,
          "digitacao": null,
          "atencao": null,
          "simulacao": null
        },
        "bonusValores": {
          "graduacao": false,
          "presencial": null
        },
        "disc": null,
        "finalista": false
      },
      {
        "id": "cu-039",
        "nome": "Olívia Rascunho",
        "status": "desistente",
        "criadoEm": "2026-08-21T18:10:00.000Z",
        "idade": 26,
        "statusTrabalho": "Estudante",
        "pretensao": 2600,
        "ultimoSalario": 2500,
        "formacao": "Ensino médio completo",
        "notas": {
          "revisao": null,
          "redacao": null,
          "digitacao": null,
          "atencao": null,
          "simulacao": null
        },
        "bonusValores": {
          "graduacao": false,
          "presencial": null
        },
        "disc": null,
        "finalista": false
      },
      {
        "id": "cu-040",
        "nome": "Priscila Provisória",
        "status": "desistente",
        "criadoEm": "2026-08-22T19:10:00.000Z",
        "idade": null,
        "statusTrabalho": "Empregado (CLT)",
        "pretensao": 2800,
        "ultimoSalario": 2900,
        "formacao": "Superior incompleto",
        "notas": {
          "revisao": null,
          "redacao": null,
          "digitacao": null,
          "atencao": null,
          "simulacao": null
        },
        "bonusValores": {
          "graduacao": false,
          "presencial": null
        },
        "disc": null,
        "finalista": false
      }
    ],
    "avisos": []
  };
  if (typeof module !== 'undefined' && module.exports) module.exports = DISC_FIXTURE_PROCESSO;
  else root.DISC_FIXTURE_PROCESSO = DISC_FIXTURE_PROCESSO;
})(typeof self !== 'undefined' ? self : this);
