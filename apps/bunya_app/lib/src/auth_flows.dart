import 'package:flutter/material.dart';

import 'data.dart';
import 'theme.dart';

class CustomerRegistrationScreen extends StatefulWidget {
  const CustomerRegistrationScreen({super.key, required this.repository});

  final BunyaRepository repository;

  @override
  State<CustomerRegistrationScreen> createState() =>
      _CustomerRegistrationScreenState();
}

class _CustomerRegistrationScreenState
    extends State<CustomerRegistrationScreen> {
  final fullName = TextEditingController();
  final email = TextEditingController();
  final phone = TextEditingController();
  final username = TextEditingController();
  final password = TextEditingController();
  final confirm = TextEditingController();
  bool passwordHidden = true;
  bool confirmHidden = true;
  bool busy = false;
  String error = '';

  @override
  void dispose() {
    fullName.dispose();
    email.dispose();
    phone.dispose();
    username.dispose();
    password.dispose();
    confirm.dispose();
    super.dispose();
  }

  Future<void> submit() async {
    final cleanName = fullName.text.trim();
    final cleanEmail = email.text.trim().toLowerCase();
    final cleanPhone = _normalizeSaudiPhone(phone.text);
    final cleanUsername = username.text.trim().replaceAll(RegExp(r'\s+'), '_');
    final passwordError = _passwordError(password.text);
    String? validationError;
    if (cleanName.length < 3) {
      validationError = 'أدخل الاسم الكامل.';
    } else if (!_emailPattern.hasMatch(cleanEmail)) {
      validationError = 'أدخل بريدًا إلكترونيًا صحيحًا.';
    } else if (cleanPhone == null) {
      validationError = 'أدخل رقم جوال سعوديًا صحيحًا، مثل 05xxxxxxxx.';
    } else if (cleanUsername.length < 4 || cleanUsername.length > 40) {
      validationError = 'اسم المستخدم يجب أن يكون من 4 إلى 40 حرفًا.';
    } else if (passwordError != null) {
      validationError = passwordError;
    } else if (password.text != confirm.text) {
      validationError = 'كلمتا المرور غير متطابقتين.';
    }
    if (validationError != null) {
      final message = validationError;
      setState(() => error = message);
      return;
    }
    final verifiedPhone = cleanPhone!;

    setState(() {
      busy = true;
      error = '';
    });
    try {
      final verificationSent = await widget.repository.registerCustomer(
        fullName: cleanName,
        email: cleanEmail,
        phone: verifiedPhone,
        username: cleanUsername,
        password: password.text,
      );
      if (!mounted) return;
      final verified = await Navigator.of(context).push<bool>(
        MaterialPageRoute(
          builder: (_) => PhoneVerificationScreen(
            repository: widget.repository,
            initialPhone: verifiedPhone,
            sendOnOpen: !verificationSent,
            codeAlreadySent: verificationSent,
          ),
        ),
      );
      if (mounted) Navigator.pop(context, verified == true);
    } catch (value) {
      if (mounted) setState(() => error = _cleanAuthError(value));
    } finally {
      if (mounted) setState(() => busy = false);
    }
  }

  @override
  Widget build(BuildContext context) => Scaffold(
    appBar: AppBar(
      leading: IconButton(
        tooltip: 'العودة',
        onPressed: () => Navigator.pop(context, false),
        icon: const Icon(Icons.arrow_forward_rounded),
      ),
    ),
    body: SafeArea(
      top: false,
      child: AutofillGroup(
        child: ListView(
          padding: const EdgeInsets.fromLTRB(22, 6, 22, 32),
          children: [
            const _AuthHeader(
              icon: Icons.person_add_alt_1_rounded,
              eyebrow: 'حساب عميل جديد',
              title: 'ابدأ مشروعك مع بُنية',
              caption: 'أدخل رقم جوالك الأساسي؛ سنرسل إليه رمز التحقق والعروض والتنبيهات المهمة.',
            ),
            const SizedBox(height: 24),
            TextField(
              controller: fullName,
              textInputAction: TextInputAction.next,
              autofillHints: const [AutofillHints.name],
              decoration: const InputDecoration(
                labelText: 'الاسم الكامل',
                prefixIcon: Icon(Icons.badge_outlined),
              ),
            ),
            const SizedBox(height: 12),
            TextField(
              controller: email,
              keyboardType: TextInputType.emailAddress,
              textInputAction: TextInputAction.next,
              textDirection: TextDirection.ltr,
              autofillHints: const [AutofillHints.email],
              decoration: const InputDecoration(
                labelText: 'البريد الإلكتروني',
                prefixIcon: Icon(Icons.mail_outline_rounded),
              ),
            ),
            const SizedBox(height: 12),
            TextField(
              controller: phone,
              keyboardType: TextInputType.phone,
              textInputAction: TextInputAction.next,
              textDirection: TextDirection.ltr,
              autofillHints: const [AutofillHints.telephoneNumber],
              decoration: const InputDecoration(
                labelText: 'رقم الجوال السعودي',
                hintText: '05xxxxxxxx',
                helperText: 'لاستلام رمز التحقق والعروض والإشعارات عبر واتساب',
                prefixIcon: Icon(Icons.phone_iphone_rounded),
              ),
            ),
            const SizedBox(height: 12),
            TextField(
              controller: username,
              textInputAction: TextInputAction.next,
              textDirection: TextDirection.ltr,
              autofillHints: const [AutofillHints.newUsername],
              decoration: const InputDecoration(
                labelText: 'اسم المستخدم',
                helperText: 'تُستبدل المسافات تلقائيًا بعلامة _',
                prefixIcon: Icon(Icons.alternate_email_rounded),
              ),
            ),
            const SizedBox(height: 12),
            _PasswordInput(
              controller: password,
              label: 'كلمة المرور',
              hidden: passwordHidden,
              autofillHint: AutofillHints.newPassword,
              onVisibility: () =>
                  setState(() => passwordHidden = !passwordHidden),
            ),
            const Padding(
              padding: EdgeInsets.fromLTRB(4, 7, 4, 12),
              child: Text(
                '8 أحرف على الأقل، وتتضمن حرفًا إنجليزيًا كبيرًا ورقمًا.',
                style: TextStyle(
                  color: BunyaColors.muted,
                  fontSize: 10,
                  fontWeight: FontWeight.w700,
                ),
              ),
            ),
            _PasswordInput(
              controller: confirm,
              label: 'تأكيد كلمة المرور',
              hidden: confirmHidden,
              autofillHint: AutofillHints.newPassword,
              onVisibility: () =>
                  setState(() => confirmHidden = !confirmHidden),
              onSubmitted: (_) => submit(),
            ),
            if (error.isNotEmpty) ...[
              const SizedBox(height: 12),
              _AuthError(message: error),
            ],
            const SizedBox(height: 20),
            FilledButton.icon(
              onPressed: busy ? null : submit,
              icon: busy
                  ? const SizedBox(
                      width: 19,
                      height: 19,
                      child: CircularProgressIndicator(
                        strokeWidth: 2,
                        color: Colors.white,
                      ),
                    )
                  : const Icon(Icons.person_add_alt_1_rounded),
              label: Text(
                busy
                    ? 'جارٍ إنشاء الحساب...'
                    : 'إنشاء الحساب وإرسال رمز التحقق',
              ),
            ),
            const SizedBox(height: 10),
            TextButton(
              onPressed: busy ? null : () => Navigator.pop(context, false),
              child: const Text('لديك حساب؟ ارجع لتسجيل الدخول'),
            ),
          ],
        ),
      ),
    ),
  );
}

class PhoneVerificationScreen extends StatefulWidget {
  const PhoneVerificationScreen({
    super.key,
    required this.repository,
    this.initialPhone = '',
    this.sendOnOpen = false,
    this.codeAlreadySent = false,
    this.onVerified,
    this.onSignedOut,
  });

  final BunyaRepository repository;
  final String initialPhone;
  final bool sendOnOpen;
  final bool codeAlreadySent;
  final VoidCallback? onVerified;
  final VoidCallback? onSignedOut;

  @override
  State<PhoneVerificationScreen> createState() =>
      _PhoneVerificationScreenState();
}

class _PhoneVerificationScreenState extends State<PhoneVerificationScreen> {
  late final TextEditingController phone = TextEditingController(
    text: widget.initialPhone,
  );
  final code = TextEditingController();
  bool codeSent = false;
  bool busy = false;
  String requestedPhone = '';
  String message = '';
  String error = '';

  @override
  void initState() {
    super.initState();
    codeSent = widget.codeAlreadySent;
    if (codeSent) {
      requestedPhone = widget.initialPhone;
      message = 'أُرسل رمز التحقق عبر واتساب. أدخل الرمز الذي وصلك.';
    } else if (widget.sendOnOpen && widget.initialPhone.isNotEmpty) {
      WidgetsBinding.instance.addPostFrameCallback((_) => requestCode());
    }
  }

  @override
  void dispose() {
    phone.dispose();
    code.dispose();
    super.dispose();
  }

  Future<void> requestCode() async {
    if (busy) return;
    final normalized = _normalizeSaudiPhone(phone.text);
    if (normalized == null) {
      setState(() => error = 'أدخل رقم جوال سعوديًا صحيحًا، مثل 05xxxxxxxx.');
      return;
    }
    setState(() {
      busy = true;
      error = '';
      message = '';
    });
    try {
      final result = await widget.repository.requestPhoneVerification(
        normalized,
      );
      if (!mounted) return;
      setState(() {
        requestedPhone = normalized;
        codeSent = true;
        code.clear();
        message = result;
      });
    } catch (value) {
      if (mounted) setState(() => error = _cleanAuthError(value));
    } finally {
      if (mounted) setState(() => busy = false);
    }
  }

  Future<void> verifyCode() async {
    if (busy) return;
    final cleanCode = code.text.replaceAll(RegExp(r'\D'), '');
    if (!RegExp(r'^\d{6}$').hasMatch(cleanCode)) {
      setState(() => error = 'أدخل رمز التحقق المكوّن من 6 أرقام.');
      return;
    }
    setState(() {
      busy = true;
      error = '';
    });
    try {
      await widget.repository.completePhoneVerification(cleanCode);
      if (!mounted) return;
      if (widget.onVerified != null) {
        widget.onVerified!();
      } else {
        Navigator.pop(context, true);
      }
    } catch (value) {
      if (mounted) setState(() => error = _cleanAuthError(value));
    } finally {
      if (mounted) setState(() => busy = false);
    }
  }

  Future<void> signOut() async {
    if (busy) return;
    setState(() => busy = true);
    await widget.repository.signOut();
    if (!mounted) return;
    if (widget.onSignedOut != null) {
      widget.onSignedOut!();
    } else {
      Navigator.pop(context, false);
    }
  }

  void editPhone() => setState(() {
    codeSent = false;
    code.clear();
    error = '';
    message = '';
  });

  @override
  Widget build(BuildContext context) => Scaffold(
    appBar: AppBar(
      automaticallyImplyLeading: false,
      actions: [
        TextButton.icon(
          onPressed: busy ? null : signOut,
          icon: const Icon(Icons.logout_rounded, size: 18),
          label: const Text('تسجيل الخروج'),
        ),
        const SizedBox(width: 10),
      ],
    ),
    body: SafeArea(
      top: false,
      child: AutofillGroup(
        child: ListView(
          padding: const EdgeInsets.fromLTRB(22, 8, 22, 32),
          children: [
            _AuthHeader(
              icon: codeSent
                  ? Icons.mark_chat_read_outlined
                  : Icons.verified_user_outlined,
              eyebrow: 'تفعيل حساب العميل',
              title: codeSent ? 'أدخل رمز التحقق' : 'وثّق رقم الجوال',
              caption: codeSent
                  ? 'أرسلنا رمزًا من 6 أرقام عبر واتساب إلى ${_maskSaudiPhone(requestedPhone)}.'
                  : 'رقم الجوال أساسي لاستلام العروض والإشعارات والتواصل المتعلق بطلباتك.',
            ),
            const SizedBox(height: 26),
            if (!codeSent) ...[
              TextField(
                controller: phone,
                autofocus: !widget.sendOnOpen,
                keyboardType: TextInputType.phone,
                textInputAction: TextInputAction.done,
                textDirection: TextDirection.ltr,
                autofillHints: const [AutofillHints.telephoneNumber],
                onSubmitted: (_) => requestCode(),
                decoration: const InputDecoration(
                  labelText: 'رقم الجوال السعودي',
                  hintText: '05xxxxxxxx',
                  helperText:
                      'تأكد أن الرقم مفعّل على واتساب ويمكنك الوصول إليه',
                  prefixIcon: Icon(Icons.phone_iphone_rounded),
                ),
              ),
              const SizedBox(height: 20),
              FilledButton.icon(
                onPressed: busy ? null : requestCode,
                icon: busy
                    ? const SizedBox(
                        width: 19,
                        height: 19,
                        child: CircularProgressIndicator(
                          strokeWidth: 2,
                          color: Colors.white,
                        ),
                      )
                    : const Icon(Icons.send_to_mobile_rounded),
                label: Text(busy ? 'جارٍ إرسال الرمز...' : 'إرسال رمز التحقق'),
              ),
            ] else ...[
              TextField(
                controller: code,
                autofocus: true,
                keyboardType: TextInputType.number,
                textInputAction: TextInputAction.done,
                textDirection: TextDirection.ltr,
                textAlign: TextAlign.center,
                maxLength: 6,
                autofillHints: const [AutofillHints.oneTimeCode],
                onChanged: (_) {
                  if (error.isNotEmpty) setState(() => error = '');
                },
                onSubmitted: (_) => verifyCode(),
                decoration: const InputDecoration(
                  labelText: 'رمز التحقق',
                  hintText: '------',
                  counterText: '',
                  prefixIcon: Icon(Icons.password_rounded),
                ),
              ),
              const SizedBox(height: 20),
              FilledButton.icon(
                onPressed: busy ? null : verifyCode,
                icon: busy
                    ? const SizedBox(
                        width: 19,
                        height: 19,
                        child: CircularProgressIndicator(
                          strokeWidth: 2,
                          color: Colors.white,
                        ),
                      )
                    : const Icon(Icons.verified_rounded),
                label: Text(busy ? 'جارٍ التحقق...' : 'تحقق وفعّل الحساب'),
              ),
              const SizedBox(height: 8),
              Row(
                children: [
                  Expanded(
                    child: TextButton(
                      onPressed: busy ? null : requestCode,
                      child: const Text('إعادة إرسال الرمز'),
                    ),
                  ),
                  Expanded(
                    child: TextButton(
                      onPressed: busy ? null : editPhone,
                      child: const Text('تعديل الرقم'),
                    ),
                  ),
                ],
              ),
            ],
            if (message.isNotEmpty) ...[
              const SizedBox(height: 12),
              _AuthNotice(message: message),
            ],
            if (error.isNotEmpty) ...[
              const SizedBox(height: 12),
              _AuthError(message: error),
            ],
          ],
        ),
      ),
    ),
  );
}

class ForgotPasswordScreen extends StatefulWidget {
  const ForgotPasswordScreen({super.key, required this.repository});

  final BunyaRepository repository;

  @override
  State<ForgotPasswordScreen> createState() => _ForgotPasswordScreenState();
}

class _ForgotPasswordScreenState extends State<ForgotPasswordScreen> {
  final email = TextEditingController();
  bool busy = false;
  bool sent = false;
  String error = '';

  @override
  void dispose() {
    email.dispose();
    super.dispose();
  }

  Future<void> submit() async {
    final cleanEmail = email.text.trim().toLowerCase();
    if (!_emailPattern.hasMatch(cleanEmail)) {
      setState(() => error = 'أدخل بريدًا إلكترونيًا صحيحًا.');
      return;
    }
    setState(() {
      busy = true;
      error = '';
    });
    try {
      await widget.repository.sendPasswordReset(cleanEmail);
      if (mounted) setState(() => sent = true);
    } catch (value) {
      if (mounted) setState(() => error = _cleanAuthError(value));
    } finally {
      if (mounted) setState(() => busy = false);
    }
  }

  @override
  Widget build(BuildContext context) => Scaffold(
    appBar: AppBar(
      leading: IconButton(
        tooltip: 'العودة',
        onPressed: () => Navigator.pop(context),
        icon: const Icon(Icons.arrow_forward_rounded),
      ),
    ),
    body: SafeArea(
      top: false,
      child: ListView(
        padding: const EdgeInsets.fromLTRB(22, 6, 22, 32),
        children: sent
            ? [
                const SizedBox(height: 48),
                const _AuthHeader(
                  icon: Icons.mark_email_read_outlined,
                  eyebrow: 'تم إرسال الطلب',
                  title: 'تحقق من بريدك',
                  caption: 'إذا كان البريد مرتبطًا بحساب فسيصلك رابط آمن لتعيين كلمة مرور جديدة.',
                  success: true,
                ),
                const SizedBox(height: 26),
                FilledButton(
                  onPressed: () => Navigator.pop(context),
                  child: const Text('العودة لتسجيل الدخول'),
                ),
              ]
            : [
                const _AuthHeader(
                  icon: Icons.lock_reset_rounded,
                  eyebrow: 'استعادة الوصول',
                  title: 'نسيت كلمة المرور؟',
                  caption: 'اكتب بريد حسابك وسنرسل لك رابطًا آمنًا لإعادة تعيين كلمة المرور.',
                ),
                const SizedBox(height: 26),
                TextField(
                  controller: email,
                  autofocus: true,
                  keyboardType: TextInputType.emailAddress,
                  textInputAction: TextInputAction.done,
                  textDirection: TextDirection.ltr,
                  autofillHints: const [AutofillHints.email],
                  onSubmitted: (_) => submit(),
                  decoration: const InputDecoration(
                    labelText: 'البريد الإلكتروني',
                    prefixIcon: Icon(Icons.mail_outline_rounded),
                  ),
                ),
                if (error.isNotEmpty) ...[
                  const SizedBox(height: 12),
                  _AuthError(message: error),
                ],
                const SizedBox(height: 20),
                FilledButton.icon(
                  onPressed: busy ? null : submit,
                  icon: busy
                      ? const SizedBox(
                          width: 19,
                          height: 19,
                          child: CircularProgressIndicator(
                            strokeWidth: 2,
                            color: Colors.white,
                          ),
                        )
                      : const Icon(Icons.outgoing_mail),
                  label: Text(
                    busy ? 'جارٍ إرسال الرابط...' : 'إرسال رابط الاستعادة',
                  ),
                ),
                const SizedBox(height: 10),
                TextButton(
                  onPressed: busy ? null : () => Navigator.pop(context),
                  child: const Text('العودة لتسجيل الدخول'),
                ),
              ],
      ),
    ),
  );
}

class _AuthHeader extends StatelessWidget {
  const _AuthHeader({
    required this.icon,
    required this.eyebrow,
    required this.title,
    required this.caption,
    this.success = false,
  });

  final IconData icon;
  final String eyebrow, title, caption;
  final bool success;

  @override
  Widget build(BuildContext context) => Column(
    crossAxisAlignment: CrossAxisAlignment.start,
    children: [
      Container(
        width: 58,
        height: 58,
        decoration: BoxDecoration(
          color: success ? BunyaColors.mint : BunyaColors.sand,
          borderRadius: BorderRadius.circular(19),
        ),
        child: Icon(
          icon,
          color: success ? BunyaColors.forest : BunyaColors.copper,
          size: 28,
        ),
      ),
      const SizedBox(height: 20),
      Text(
        eyebrow,
        style: TextStyle(
          color: success ? BunyaColors.forest : BunyaColors.copper,
          fontSize: 12,
          fontWeight: FontWeight.w900,
        ),
      ),
      const SizedBox(height: 5),
      Text(
        title,
        style: Theme.of(context).textTheme.headlineMedium
            ?.copyWith(fontWeight: FontWeight.w900, height: 1.3),
      ),
      const SizedBox(height: 8),
      Text(
        caption,
        style: const TextStyle(
          color: BunyaColors.muted,
          height: 1.75,
          fontWeight: FontWeight.w700,
        ),
      ),
    ],
  );
}

class _PasswordInput extends StatelessWidget {
  const _PasswordInput({
    required this.controller,
    required this.label,
    required this.hidden,
    required this.autofillHint,
    required this.onVisibility,
    this.onSubmitted,
  });

  final TextEditingController controller;
  final String label, autofillHint;
  final bool hidden;
  final VoidCallback onVisibility;
  final ValueChanged<String>? onSubmitted;

  @override
  Widget build(BuildContext context) => TextField(
    controller: controller,
    obscureText: hidden,
    textDirection: TextDirection.ltr,
    textInputAction: onSubmitted == null
        ? TextInputAction.next
        : TextInputAction.done,
    autofillHints: [autofillHint],
    onSubmitted: onSubmitted,
    decoration: InputDecoration(
      labelText: label,
      prefixIcon: const Icon(Icons.lock_outline_rounded),
      suffixIcon: IconButton(
        tooltip: hidden ? 'إظهار كلمة المرور' : 'إخفاء كلمة المرور',
        onPressed: onVisibility,
        icon: Icon(
          hidden ? Icons.visibility_outlined : Icons.visibility_off_outlined,
        ),
      ),
    ),
  );
}

class _AuthError extends StatelessWidget {
  const _AuthError({required this.message});

  final String message;

  @override
  Widget build(BuildContext context) => Semantics(
    liveRegion: true,
    child: Container(
      padding: const EdgeInsets.all(12),
      decoration: BoxDecoration(
        color: const Color(0xFFFDE9E7),
        borderRadius: BorderRadius.circular(14),
        border: Border.all(color: BunyaColors.danger.withValues(alpha: .2)),
      ),
      child: Row(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          const Icon(
            Icons.error_outline_rounded,
            color: BunyaColors.danger,
            size: 19,
          ),
          const SizedBox(width: 8),
          Expanded(
            child: Text(
              message,
              style: const TextStyle(
                color: BunyaColors.danger,
                height: 1.55,
                fontSize: 11,
                fontWeight: FontWeight.w800,
              ),
            ),
          ),
        ],
      ),
    ),
  );
}

class _AuthNotice extends StatelessWidget {
  const _AuthNotice({required this.message});

  final String message;

  @override
  Widget build(BuildContext context) => Semantics(
    liveRegion: true,
    child: Container(
      padding: const EdgeInsets.all(12),
      decoration: BoxDecoration(
        color: BunyaColors.mint,
        borderRadius: BorderRadius.circular(14),
        border: Border.all(color: BunyaColors.forest.withValues(alpha: .16)),
      ),
      child: Row(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          const Icon(
            Icons.check_circle_outline_rounded,
            color: BunyaColors.forest,
            size: 19,
          ),
          const SizedBox(width: 8),
          Expanded(
            child: Text(
              message,
              style: const TextStyle(
                color: BunyaColors.forest,
                height: 1.55,
                fontSize: 11,
                fontWeight: FontWeight.w800,
              ),
            ),
          ),
        ],
      ),
    ),
  );
}

final _emailPattern = RegExp(r'^[^\s@]+@[^\s@]+\.[^\s@]+$');

String? _normalizeSaudiPhone(String value) {
  var digits = value.replaceAll(RegExp(r'\D'), '');
  if (digits.startsWith('05')) {
    digits = '966${digits.substring(1)}';
  } else if (digits.startsWith('5')) {
    digits = '966$digits';
  }
  return RegExp(r'^9665\d{8}$').hasMatch(digits) ? '+$digits' : null;
}

String _maskSaudiPhone(String value) {
  final digits = value.replaceAll(RegExp(r'\D'), '');
  if (digits.length < 7) return '***';
  return '${digits.substring(0, 3)}****${digits.substring(digits.length - 3)}';
}

String? _passwordError(String value) {
  if (value.length < 8) return 'يجب ألا تقل كلمة المرور عن 8 أحرف.';
  if (!RegExp(r'[A-Z]').hasMatch(value)) {
    return 'أضف حرفًا إنجليزيًا كبيرًا واحدًا على الأقل.';
  }
  if (!RegExp(r'[0-9]').hasMatch(value)) {
    return 'أضف رقمًا واحدًا على الأقل.';
  }
  return null;
}

String _cleanAuthError(Object value) {
  final message = '$value'.replaceFirst(RegExp(r'^Exception:\s*'), '').trim();
  if (message.isEmpty) return 'تعذر إكمال العملية. حاول مجددًا.';
  return message;
}
