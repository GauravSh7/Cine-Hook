// All requested seats share one Redis Cluster hash slot. These scripts are the
// atomic boundary; no client-side check/write sequence can provide that guarantee.
export const acquireScript = `
redis.replicate_commands()
for _, key in ipairs(KEYS) do
  if redis.call('EXISTS', key) == 1 then return {0} end
end
local now = redis.call('TIME')
local expiresAt = tonumber(now[1]) * 1000 + math.floor(tonumber(now[2]) / 1000) + tonumber(ARGV[2])
local written = {}
for _, key in ipairs(KEYS) do
  local result = redis.pcall('SET', key, ARGV[1], 'PX', ARGV[2])
  if type(result) == 'table' and result.err then
    for _, created in ipairs(written) do redis.call('DEL', created) end
    return redis.error_reply('Seat lock write failed')
  end
  written[#written + 1] = key
end
return {1, expiresAt}
`;

export const releaseScript = `
local released = 0
for _, key in ipairs(KEYS) do
  if redis.call('GET', key) == ARGV[1] then
    released = released + redis.call('DEL', key)
  end
end
return released
`;

export const validateScript = `
for _, key in ipairs(KEYS) do
  if redis.call('GET', key) ~= ARGV[1] or redis.call('PTTL', key) <= 0 then return 0 end
end
return 1
`;

export const inspectScript = `
local result = {}
for _, key in ipairs(KEYS) do
  local ttl = redis.call('PTTL', key)
  if ttl == -2 then
    result[#result + 1] = {0, 0}
  else
    result[#result + 1] = {1, math.max(0, ttl)}
  end
end
return result
`;
