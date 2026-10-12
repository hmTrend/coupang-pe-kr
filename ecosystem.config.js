// pm2 설정. in-flight dedup / 호출 제한 백오프 / rate limit 상태가 프로세스 메모리에 있으므로
// 반드시 단일 인스턴스(fork)로 실행해야 한다. cluster 모드·다중 인스턴스 금지.
module.exports = {
  apps: [
    {
      name: "coupang-pe-kr",
      script: "node_modules/next/dist/bin/next",
      args: "start -p 3000",
      instances: 1,
      exec_mode: "fork",
      autorestart: true,
      max_memory_restart: "512M",
      env: {
        NODE_ENV: "production",
        PORT: 3000,
      },
    },
  ],
};
