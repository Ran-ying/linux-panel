# Shared upstream stanza for exact-match credential/token locations.
proxy_pass http://127.0.0.1:4188;
proxy_http_version 1.1;
proxy_set_header Host $host;
proxy_set_header X-Forwarded-Proto https;
proxy_set_header X-Forwarded-For $remote_addr;
proxy_set_header X-Real-IP $remote_addr;
proxy_set_header X-Forwarded-Host "";
proxy_set_header Connection "";
proxy_connect_timeout 5s;
proxy_read_timeout 120s;
proxy_send_timeout 120s;
proxy_buffering off;
