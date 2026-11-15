// Variáveis mínimas para importar os módulos do backend nos testes (o pool do Postgres não conecta sozinho).
process.env.DATABASE_URL ||= 'postgres://teste:teste@127.0.0.1:1/teste';
process.env.JWT_SECRET ||= 'segredo-de-teste-com-mais-de-32-caracteres';
