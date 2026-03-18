/**
 * API 测试脚本
 * 用于验证千问 API 是否正常工作
 */

require('dotenv').config();
const OpenAI = require('openai');

async function testQwenAPI() {
    console.log('='.repeat(50));
    console.log('测试千问 API 连接');
    console.log('='.repeat(50));

    // 检查环境变量
    console.log('\n[1] 检查环境变量...');
    console.log(`API Key: ${process.env.OPENAI_API_KEY ? '已设置 (' + process.env.OPENAI_API_KEY.substring(0, 10) + '...)' : '未设置'}`);
    console.log(`Base URL: ${process.env.OPENAI_BASE_URL || '未设置'}`);
    console.log(`Model: ${process.env.OPENAI_MODEL || 'qwen-plus (默认)'}`);

    if (!process.env.OPENAI_API_KEY) {
        console.error('\n错误: OPENAI_API_KEY 未设置，请检查 .env 文件');
        process.exit(1);
    }

    // 创建 OpenAI 客户端
    const openai = new OpenAI({
        apiKey: process.env.OPENAI_API_KEY,
        baseURL: process.env.OPENAI_BASE_URL || 'https://dashscope.aliyuncs.com/compatible-mode/v1',
    });

    const model = process.env.OPENAI_MODEL || 'qwen-plus';

    // 测试简单对话
    console.log('\n[2] 测试 API 调用...');
    try {
        const response = await openai.chat.completions.create({
            model: model,
            messages: [
                { role: 'system', content: '你是一个有帮助的助手。' },
                { role: 'user', content: '请用一句话介绍自己。' }
            ],
            max_tokens: 100,
            temperature: 0.7
        });

        console.log('\n API 调用成功!');
        console.log(`模型: ${model}`);
        console.log(`响应: ${response.choices[0].message.content}`);
        console.log(`Token 使用: ${JSON.stringify(response.usage)}`);

    } catch (error) {
        console.error('\n API 调用失败!');
        console.error(`错误类型: ${error.constructor.name}`);
        console.error(`错误信息: ${error.message}`);

        if (error.response) {
            console.error(`状态码: ${error.response.status}`);
            console.error(`响应体: ${JSON.stringify(error.response.data)}`);
        }

        // 常见错误诊断
        console.log('\n[诊断建议]');
        if (error.message.includes('401') || error.message.includes('Unauthorized')) {
            console.log('- API Key 无效或已过期，请检查千问控制台');
        } else if (error.message.includes('404')) {
            console.log('- 模型名称可能不正确，尝试使用: qwen-plus, qwen-turbo, qwen-max');
        } else if (error.message.includes('429')) {
            console.log('- API 调用频率超限，请稍后重试');
        } else if (error.message.includes('ECONNREFUSED') || error.message.includes('ETIMEDOUT')) {
            console.log('- 网络连接问题，请检查网络或使用代理');
        }

        process.exit(1);
    }

    console.log('\n' + '='.repeat(50));
    console.log(' 所有测试通过!');
    console.log('='.repeat(50));
}

testQwenAPI();
